# Crash Anatomy — Interactive Map of Fatal US Traffic Collisions

**Live demo:** [kalchikee.github.io/crash-anatomy](https://kalchikee.github.io/crash-anatomy)

An interactive web application mapping every fatal motor vehicle collision in the United States from 2019–2023, built from the NHTSA Fatality Analysis Reporting System (FARS).

## Key Findings (2019–2023)

| Metric | Value |
|--------|-------|
| Total fatal crashes | 185,552 |
| Total fatalities | 201,433 |
| Night-time crashes | 41.6% |
| Pedestrian-involved | 22.2% |
| Rural crashes | 40.5% |
| Deadliest state | California (20,776) |

## Features

- **National heatmap** showing fatal crash density across the US
- **Cluster view** at medium zoom with crash counts
- **Individual crash points** at high zoom, color-coded by road type
- **Click popups** with full crash details: date, weather, road type, contributing factors
- **Real-time filters**: year, crash type, road type, urban/rural
- **Live charts**: fatalities by year, crash type breakdown, top 10 states

## Data Sources

| Dataset | Source | Years |
|---------|--------|-------|
| Fatal crash locations & attributes | [NHTSA FARS](https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars) | 2019–2023 |

All data is publicly available and published by the National Highway Traffic Safety Administration.

## Tech Stack

- **Map rendering:** [MapLibre GL JS](https://maplibre.org/) (open-source, no API key required)
- **Base map:** Carto Dark Matter (free tier)
- **Data format:** GeoJSON compressed with gzip (~2.7 MB download / 40 MB uncompressed)
- **Hosting:** GitHub Pages (fully static, no server required)
- **Processing:** Python (pandas, geopandas)

## Project Structure

```
/
├── index.html              # Main app shell
├── style.css               # Dark theme styles
├── app.js                  # Map logic, filters, charts
├── data/
│   ├── processed/
│   │   ├── crashes.geojson.gz      # 185K crash points (2.7 MB gzipped)
│   │   ├── summary_stats.json      # Aggregated statistics
│   │   └── state_summary.geojson   # State-level totals
│   └── raw/                        # Original FARS CSVs (gitignored)
├── src/
│   └── process_fars.py     # Data processing pipeline
└── README.md
```

## Reproducing the Data

```bash
# Install dependencies
pip install pandas requests

# Download FARS data and process (requires ~500 MB disk space)
python src/process_fars.py
```

The processing script downloads the FARS Accident and Person tables for 2019–2023 directly from NHTSA, filters for valid GPS coordinates, classifies crash types, and generates the compressed GeoJSON and summary statistics.

## Crash Type Classification

| Type | FARS Coding |
|------|-------------|
| Pedestrian | `PEDS > 0` |
| Cyclist | `PERNOTMVIT > 0` and `PEDS = 0` |
| Night-time | `LGT_COND` in {2, 3, 4, 5} (dark/dawn/dusk) |
| Adverse Weather | `WEATHER` in {2, 3, 4, 5, 10, 11} (rain/snow/fog/sleet) |
| Intersection-related | `RELJCT2` in {2–8} |
| Work Zone | `WRK_ZONE > 0` |

## Portfolio Context

This project is part of a GIS portfolio demonstrating national-scale spatial data processing, web mapping, and data visualization. Traffic safety analysis is a core domain for state DOTs, metropolitan planning organizations, and transportation consulting firms.

---

Data source: [National Highway Traffic Safety Administration — FARS](https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars)
