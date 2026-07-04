# Analytics

Analytics helps you understand user behavior across your application with three complementary views: Overview, Funnel, and Heatmap. You must configure analytics tracking before data appears.

## Page purpose

- **Overview** — Aggregate event metrics: total events, unique users, event type breakdown, and trends over time.
- **Funnel** — Define multi-step conversion funnels to measure drop-off between stages.
- **Heatmap** — Visual click and interaction heatmaps overlaid on your page screenshots.

## Overview

The overview dashboard shows aggregate analytics data.

### What you will see

- Total event count and unique user count for the selected time range.
- Event type distribution (page views, clicks, form submissions, custom events).
- Daily trend chart showing event volume over time.
- Top pages by event count.
- Top events by type.

### Filters

- Date range picker (preset ranges: last 7 days, 30 days, 90 days, custom).
- Event type filter.
- Page path filter.

## Funnel

Funnels measure conversion through a sequence of steps. Each step is a tracked event.

### Creating a funnel

1. Name the funnel and select a date range.
2. Define steps: each step has a name and an event filter (event type + optional page path).
3. The funnel computes how many users completed each step and the conversion rate between steps.
4. Save funnels for later reuse.

### Reading the funnel chart

- Each step shows the user count and percentage relative to step 1.
- The drop-off percentage between consecutive steps is highlighted.
- Hover over any step for detailed numbers.

## Heatmap

Heatmaps show where users click and interact on a given page.

### Endpoint configuration

The heatmap endpoint is configurable. Contact your administrator if the heatmap is not collecting data.

### Viewing a heatmap

1. Select a page URL from the tracked pages.
2. Choose the date range.
3. The heatmap renders click density overlaid on the page screenshot.
4. Hotter colors (red) indicate higher click density; cooler colors (blue) indicate lower density.

### Data collection

Heatmap data is only collected when the heatmap endpoint is configured and the tracking script is loaded on the target page.

## Permission requirements

| Action | Required permission |
|--------|-------------------|
| View analytics overview | `ANALYTICS_OVERVIEW` |
| View analytics funnel | `ANALYTICS_FUNNEL` |
| View analytics heatmap | `ANALYTICS_HEATMAP` |
| Configure heatmap endpoint | `SYSTEM_CONFIG` |

## Notes

- Analytics data depends on the client-side tracking script. Ensure it is properly installed on all pages you want to track.
- Event data may have a short processing delay (typically under 5 minutes).
- Funnel definitions are saved per user and are not shared across accounts.
- Heatmap screenshots require the target page to be accessible for capture.

## Related pages

- `system-configuration`
- `debug-tools`
