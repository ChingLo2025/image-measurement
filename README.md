## Image Measurement Tool

A lightweight, web-based image measurement tool designed for SEM and microscopy images.

## Features

- Upload SEM / microscopy images (JPG / PNG)
- Scale calibration using two-point reference
- Three measurement modes:
  - **Point–Point** (e.g. particle size, width)
  - **Point–Line** (e.g. distance to a reference edge)
  - **Line–Line** (e.g. height, spacing)
- Visual auxiliary lines to assist alignment
- Measured lines and endpoints remain on the image to avoid duplicate measurements
- Export measurement results as CSV
- Fully client-side

---

## Usage Flow

1. Upload an image
2. Calibrate scale by selecting two points and entering the real distance
3. Select a measurement mode
4. Click to measure distances on the image
5. Download results as CSV

---

## CSV Output
The exported CSV contains only essential data:
```csv
id,distance_<unit>
1,124.2
2,90.6
3,87.1
