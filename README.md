# Campground Scanner

Monitors Parks Canada and BC Parks campground availability and sends push notifications via [Pushover](https://pushover.net) when sites open up.

## Setup

### 1. Install dependencies

```
npm install
```

### 2. Configure

Copy the example config files and fill in your values:

```
cp config/credentials.example.json config/credentials.json
cp config/searches.example.json config/searches.json
```

**`config/credentials.json`** — Pushover API credentials:

```json
{
    "pushover": {
        "adminGroup": "your-pushover-group-key",
        "token": "your-pushover-app-token"
    }
}
```

**`config/searches.json`** — Array of campground searches:

| Field       | Required | Description                                          |
|-------------|----------|------------------------------------------------------|
| `name`      | No       | Label for logging                                    |
| `type`      | No       | `"map"` (default) or `"site"`                        |
| `baseUrl`   | Yes      | `"canada"` (Parks Canada) or `"bc"` (BC Parks)       |
| `mapId`     | Yes      | Campground map ID                                    |
| `siteId`    | Site only| Specific campsite ID (required when type is `"site"`)|
| `startDate` | Yes      | Check-in date (`YYYY-MM-DD`)                         |
| `endDate`   | Yes      | Check-out date (`YYYY-MM-DD`)                        |

- **`map`** searches all sites within a campground and notifies when any site is available.
- **`site`** monitors one specific campsite.

### 3. Run

Locally (runs once):

```
node campground-scanner.js
```

With Docker Compose (polls every 60 seconds):

```
docker compose up -d
```

## Docker

The `docker-compose.yml` mounts `./config` into the container. To rebuild after code changes:

```
docker compose up -d --build
```
