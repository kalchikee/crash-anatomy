"""
FARS Data Processing Pipeline
Processes 2019-2023 FARS data into web-ready GeoJSON and JSON files.
"""
import pandas as pd
import numpy as np
import json
import os
import sys

RAW = r"c:/Users/kalch/OneDrive/Desktop/Portfolio/Crash Anatomy/data/raw"
OUT  = r"c:/Users/kalch/OneDrive/Desktop/Portfolio/Crash Anatomy/data/processed"
os.makedirs(OUT, exist_ok=True)

YEARS = [2019, 2020, 2021, 2022, 2023]

# ── helpers ──────────────────────────────────────────────────────────────────

def classify_crash(row):
    """Return primary crash type flag string."""
    flags = []
    # Pedestrian / cyclist
    if row.get('PEDS', 0) > 0:
        flags.append('pedestrian')
    if row.get('PERNOTMVIT', 0) > 0 and row.get('PEDS', 0) == 0:
        flags.append('cyclist')
    # Work zone
    if row.get('WRK_ZONE', 0) > 0:
        flags.append('workzone')
    # Intersection-related
    reljct = row.get('RELJCT2', 0)
    if reljct in [2, 3, 4, 5, 6, 7, 8]:
        flags.append('intersection')
    # Night  (LGT_COND 2=Dark-lit, 3=Dark-not-lit, 4=Dawn, 5=Dusk)
    if row.get('LGT_COND', 0) in [2, 3, 4, 5]:
        flags.append('night')
    # Weather (2=rain, 3=sleet, 4=snow, 5=fog, 10=blowing snow, 11=blowing sand)
    if row.get('WEATHER', 0) in [2, 3, 4, 5, 10, 11]:
        flags.append('weather')
    return ','.join(flags) if flags else 'other'

def get_hour_category(hour):
    if hour in [99, 88]: return 'unknown'
    if 6 <= hour <= 9:   return 'morning'
    if 10 <= hour <= 15: return 'midday'
    if 16 <= hour <= 19: return 'evening'
    return 'night'

# ── load & combine accident tables ───────────────────────────────────────────

print("Loading accident tables...", flush=True)
acc_frames = []
for yr in YEARS:
    # handle both .CSV and .csv
    for fn in [f'{yr}_accident.CSV', f'{yr}_accident.csv']:
        path = os.path.join(RAW, fn)
        if os.path.exists(path):
            df = pd.read_csv(path, low_memory=False, encoding='latin-1')
            df['YEAR'] = yr
            acc_frames.append(df)
            print(f"  {yr}: {len(df):,} crashes", flush=True)
            break

acc = pd.concat(acc_frames, ignore_index=True)
print(f"Total crashes: {len(acc):,}", flush=True)

# ── filter valid coordinates ──────────────────────────────────────────────────
# NHTSA stores 77.7777 or 88.8888 etc. as sentinels for missing
lat_col = 'LATITUDE' if 'LATITUDE' in acc.columns else 'LATITUDENAME'
lon_col = 'LONGITUD'  if 'LONGITUD'  in acc.columns else 'LONGITUDNAME'

acc = acc.rename(columns={lat_col: 'lat', lon_col: 'lon'})
acc['lat'] = pd.to_numeric(acc['lat'], errors='coerce')
acc['lon'] = pd.to_numeric(acc['lon'], errors='coerce')

# Valid coords: lat 20-50 (CONUS + AK/HI range), lon -170 to -60
mask = (
    acc['lat'].notna() & acc['lon'].notna() &
    (acc['lat'] > 17) & (acc['lat'] < 72) &
    (acc['lon'] > -172) & (acc['lon'] < -60)
)
acc = acc[mask].copy()
print(f"With valid coords: {len(acc):,}", flush=True)

# ── build crash type + time fields ────────────────────────────────────────────
acc['type']     = acc.apply(classify_crash, axis=1)
acc['tod']      = acc['HOUR'].apply(get_hour_category)
acc['month']    = acc['MONTH'].fillna(0).astype(int)
acc['fatals']   = acc['FATALS'].fillna(1).astype(int)
acc['ped_flag'] = (acc['PEDS'] > 0).astype(int)
acc['state']    = acc['STATENAME'].fillna('Unknown')
acc['year']     = acc['YEAR'].astype(int)
acc['weather_c']= acc['WEATHERNAME'].fillna('').str.split('/').str[0].str.strip()

# road type shorthand
func_map = {1:'Interstate', 2:'Freeway', 3:'Principal Arterial',
            4:'Minor Arterial', 5:'Collector', 6:'Local', 7:'Local', 99:'Unknown'}
acc['road'] = acc['FUNC_SYS'].map(func_map).fillna('Unknown')

# rural/urban
acc['rural'] = (acc['RUR_URB'] == 1).astype(int)

# ── write compact GeoJSON (all crashes, minimal fields) ───────────────────────
print("Building GeoJSON...", flush=True)

features = []
for _, r in acc.iterrows():
    feat = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [round(r['lon'], 5), round(r['lat'], 5)]
        },
        "properties": {
            "yr":  int(r['year']),
            "mo":  int(r['month']),
            "hr":  int(r['HOUR']) if r['HOUR'] not in [88,99] else -1,
            "tod": r['tod'],
            "fat": int(r['fatals']),
            "typ": r['type'],
            "rd":  r['road'],
            "rur": int(r['rural']),
            "wth": r['weather_c'][:20] if r['weather_c'] else '',
            "st":  r['state'][:2] if len(r['state']) >= 2 else r['state'],
        }
    }
    features.append(feat)

geojson = {"type": "FeatureCollection", "features": features}
out_path = os.path.join(OUT, 'crashes.geojson')
with open(out_path, 'w') as f:
    json.dump(geojson, f, separators=(',', ':'))
print(f"Wrote {out_path} ({os.path.getsize(out_path)/1e6:.1f} MB)", flush=True)

# ── summary stats ──────────────────────────────────────────────────────────────
print("Computing summary stats...", flush=True)

total_fatalities = int(acc['fatals'].sum())
total_crashes    = len(acc)

by_year  = acc.groupby('year')['fatals'].sum().to_dict()
by_state = acc.groupby('state')['fatals'].sum().sort_values(ascending=False).to_dict()

by_type_raw = {}
for _, r in acc.iterrows():
    for t in r['type'].split(','):
        by_type_raw[t] = by_type_raw.get(t, 0) + 1

by_hour = {}
for _, r in acc.iterrows():
    h = int(r['HOUR']) if r['HOUR'] not in [88, 99] else -1
    by_hour[str(h)] = by_hour.get(str(h), 0) + 1

by_month = acc.groupby('month')['fatals'].sum().to_dict()
by_month = {str(k): int(v) for k, v in by_month.items()}

by_road  = acc.groupby('road')['fatals'].sum().sort_values(ascending=False).to_dict()

top_states = dict(list(by_state.items())[:10])

summary = {
    "total_fatalities":  total_fatalities,
    "total_crashes":     total_crashes,
    "years_covered":     YEARS,
    "by_year":           {str(k): int(v) for k, v in by_year.items()},
    "by_state":          {k: int(v) for k, v in by_state.items()},
    "by_crash_type":     {k: int(v) for k, v in by_type_raw.items()},
    "by_hour":           by_hour,
    "by_month":          by_month,
    "by_road_type":      {k: int(v) for k, v in by_road.items()},
    "top_states":        {k: int(v) for k, v in top_states.items()},
    "pct_night":         round(acc[acc['tod']=='night'].shape[0] / total_crashes * 100, 1),
    "pct_pedestrian":    round(acc[acc['ped_flag']==1].shape[0]  / total_crashes * 100, 1),
    "pct_rural":         round(acc[acc['rural']==1].shape[0]     / total_crashes * 100, 1),
}

out_path = os.path.join(OUT, 'summary_stats.json')
with open(out_path, 'w') as f:
    json.dump(summary, f, indent=2)
print(f"Wrote {out_path}", flush=True)

# ── state-level GeoJSON ────────────────────────────────────────────────────────
# Use approximate state centroids for a choropleth fallback
STATE_CENTROIDS = {
    "Alabama":(32.8,-86.8),"Alaska":(64.2,-153.0),"Arizona":(34.3,-111.1),
    "Arkansas":(34.9,-92.4),"California":(37.2,-119.5),"Colorado":(39.1,-105.4),
    "Connecticut":(41.6,-72.7),"Delaware":(39.0,-75.5),"Florida":(28.5,-81.4),
    "Georgia":(32.7,-83.4),"Hawaii":(20.3,-156.4),"Idaho":(44.4,-114.5),
    "Illinois":(40.0,-89.2),"Indiana":(39.9,-86.3),"Iowa":(42.1,-93.5),
    "Kansas":(38.5,-98.3),"Kentucky":(37.8,-84.8),"Louisiana":(31.2,-91.8),
    "Maine":(45.3,-69.0),"Maryland":(39.1,-76.8),"Massachusetts":(42.3,-71.8),
    "Michigan":(44.3,-85.4),"Minnesota":(46.4,-93.1),"Mississippi":(32.7,-89.7),
    "Missouri":(38.4,-92.5),"Montana":(47.0,-110.5),"Nebraska":(41.5,-99.9),
    "Nevada":(39.3,-116.6),"New Hampshire":(43.7,-71.6),"New Jersey":(40.1,-74.5),
    "New Mexico":(34.5,-106.1),"New York":(42.9,-75.6),"North Carolina":(35.6,-79.4),
    "North Dakota":(47.5,-100.5),"Ohio":(40.4,-82.8),"Oklahoma":(35.6,-97.5),
    "Oregon":(43.9,-120.6),"Pennsylvania":(40.9,-77.8),"Rhode Island":(41.7,-71.5),
    "South Carolina":(33.9,-81.1),"South Dakota":(44.4,-100.3),"Tennessee":(35.9,-86.4),
    "Texas":(31.5,-99.3),"Utah":(39.3,-111.1),"Vermont":(44.1,-72.7),
    "Virginia":(37.5,-78.9),"Washington":(47.4,-120.4),"West Virginia":(38.6,-80.6),
    "Wisconsin":(44.3,-89.8),"Wyoming":(43.0,-107.6),"District of Columbia":(38.9,-77.0),
}

state_feats = []
for state, fatals in by_state.items():
    coords = STATE_CENTROIDS.get(state)
    if not coords:
        continue
    state_feats.append({
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [coords[1], coords[0]]},
        "properties": {"state": state, "fatalities": int(fatals)}
    })

state_geojson = {"type": "FeatureCollection", "features": state_feats}
out_path = os.path.join(OUT, 'state_summary.geojson')
with open(out_path, 'w') as f:
    json.dump(state_geojson, f, separators=(',', ':'))
print(f"Wrote {out_path}", flush=True)

print("\n=== DONE ===")
print(f"  Total crashes with coords: {total_crashes:,}")
print(f"  Total fatalities:          {total_fatalities:,}")
print(f"  Pct night:                 {summary['pct_night']}%")
print(f"  Pct pedestrian:            {summary['pct_pedestrian']}%")
print(f"  Pct rural:                 {summary['pct_rural']}%")
