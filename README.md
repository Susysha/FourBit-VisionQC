# VisionQC

> **Browser-based visual quality inspection using computer vision and anomaly detection.**

VisionQC is a visual quality-control system that detects abnormalities in products by comparing them with a set of normal reference samples. The system supports live camera inspection and image upload, and performs the core inspection directly in the browser. It provides automated PASS/FAIL decisions along with anomaly scores, heatmaps, and defect-region information to make the inspection result easier to understand.

---

# 1. Project Overview

## Problem

Visual quality inspection in manufacturing is often dependent on manual checking or expensive computer-vision infrastructure. Manual inspection can be time-consuming and inconsistent, while conventional automated systems may require dedicated hardware and server-side processing.

VisionQC explores a lightweight approach to automated visual inspection where the core computer-vision pipeline can run directly in the browser.

## Solution

VisionQC learns the visual characteristics of **normal products** from reference samples and compares new inspection images against this reference.

The system:

1. Captures or receives an image of the product.
2. Detects and isolates the product region.
3. Normalizes the image.
4. Extracts visual features at multiple scales.
5. Compares the features against a normal-product memory bank.
6. Detects anomalous regions.
7. Generates a heatmap and defect information.
8. Produces a final **PASS / FAIL** result.
9. Stores the inspection result for later review.

---

# 2. Key Features

### Live Camera Inspection
Inspect products using the browser's camera through `getUserMedia`.

### Reference Dataset
Create a dataset of normal product samples that is used as the reference for anomaly detection.

### Multi-Scale Anomaly Detection
The system analyses image patches at fine, medium, and coarse scales to detect both local and larger visual abnormalities.

### PatchCore-Inspired Detection
VisionQC uses a PatchCore-inspired memory-bank approach with handcrafted visual features and nearest-neighbour comparison.

### Anomaly Heatmap
Detected anomalies are represented spatially so the operator can see where the system found a potential defect.

### Defect Region Information
The inspection result provides information about the detected anomalous region, including bounding information and peak anomaly location.

### PASS / FAIL Decision
A composite anomaly score is compared against a configurable threshold to produce an inspection result.

### Live Inspection State Machine
The camera workflow tracks product entry, inspection, result recording, and product exit instead of treating every camera frame as a separate inspection.

### Inspection History
Inspection results can be stored and reviewed through the application.

### Dashboard
Provides an overview of inspection activity and results.

### Image Upload
Products can also be inspected using uploaded images instead of the live camera.

---

# 3. Technology Stack

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- Framer Motion
- Lucide React

## Computer Vision

- Browser-native image processing
- Multi-scale patch feature extraction
- Local Contrast Normalization (LCN)
- Gradient and texture features
- Coreset-style memory sampling
- Nearest-neighbour anomaly detection
- Connected-component analysis
- Anomaly heatmap generation

## Authentication & Storage

- Firebase Authentication
- Firebase Firestore
- SQLite through `sql.js` as a local fallback

---

# 4. Architecture / Workflow

## Overall Workflow

```text
                    ┌──────────────────┐
                    │ Camera / Upload  │
                    └────────┬─────────┘
                             │
                             ▼
                   ┌────────────────────┐
                   │ Image Quality Check│
                   └─────────┬──────────┘
                             │
                             ▼
                   ┌────────────────────┐
                   │ Product Detection  │
                   └─────────┬──────────┘
                             │
                             ▼
                   ┌────────────────────┐
                   │ Image Normalization│
                   └─────────┬──────────┘
                             │
                             ▼
                   ┌────────────────────┐
                   │ Multi-Scale Patch  │
                   │ Feature Extraction │
                   └─────────┬──────────┘
                             │
                             ▼
                   ┌────────────────────┐
                   │ Normal Reference   │
                   │ Memory Bank        │
                   └─────────┬──────────┘
                             │
                             ▼
                   ┌────────────────────┐
                   │ Anomaly Detection  │
                   └─────────┬──────────┘
                             │
                  ┌──────────┴───────────┐
                  ▼                      ▼
          ┌───────────────┐      ┌───────────────┐
          │ Anomaly Score │      │ Anomaly Map   │
          └───────┬───────┘      └───────┬───────┘
                  │                       │
                  └──────────┬────────────┘
                             ▼
                    ┌─────────────────┐
                    │  PASS / FAIL    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Inspection Log  │
                    └─────────────────┘
```

## Inspection Pipeline

VisionQC uses a **PatchCore-inspired** approach.

The current implementation uses handcrafted visual features rather than a pretrained deep-learning backbone.

Each image is analysed at multiple patch scales:

| Scale | Patch Grid | Patches |
|---|---:|---:|
| Fine | 28 × 21 | 588 |
| Medium | 14 × 10 | 140 |
| Coarse | 7 × 5 | 35 |

The extracted features include information related to:

- Luminance and contrast
- Gradients and edge direction
- Colour statistics
- Texture
- Spatial position

Normal samples are represented using a compact memory bank. During inspection, new patches are compared against this memory using nearest-neighbour distances.

The resulting anomaly information is then combined into a composite score used for the final PASS/FAIL decision.

---

# 5. Dataset / API Information

## Dataset

VisionQC uses **normal reference images provided by the user**.

These samples represent acceptable product appearance and are used to build the reference memory for anomaly detection.

The current core inspection pipeline does not require an external defect dataset.

## API / Backend

The main computer-vision inspection process runs directly in the browser.

No external ML inference API is required for the core inspection workflow.

Firebase is used for:

- User authentication
- Persistent application data
- Inspection records

A backend endpoint is present in the project configuration for potential future expansion.

---

# 6. Setup & Installation

## Requirements

- Node.js
- npm
- Modern web browser
- Camera access for live inspection

## Clone the repository

```bash
git clone <GITHUB-REPOSITORY-LINK>
cd visionQC
```

## Install dependencies

```bash
npm install
```

## Configure Firebase

Create a `.env` file containing the Firebase configuration required by the project.

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## Start the application

```bash
npm run dev
```

Open the local URL provided by Vite.

## Build

```bash
npm run build
```

## Type Check

```bash
npm run lint
```

---

# 7. Screenshots / Demo

## Dashboard

<img width="1917" height="975" alt="image" src="https://github.com/user-attachments/assets/af494dda-80fa-4f42-bbc5-32df13ea1811" />


## Dataset / Reference Samples

<img width="1080" height="1340" alt="image" src="https://github.com/user-attachments/assets/81e378cd-1566-4d93-9ea9-fca0d3413656" />

<img width="700" height="838" alt="image" src="https://github.com/user-attachments/assets/a16d4afe-2991-49a0-bc0e-6fc438d9c8cf" />


---

# 8. Limitations & Future Scope

## Current Limitations

### PatchCore-inspired implementation

The current implementation is inspired by PatchCore but does not use the complete deep-learning PatchCore architecture. It currently uses handcrafted visual features instead of pretrained CNN/ViT embeddings.

### Camera integration

The current application uses the browser's camera API. Direct integration with industrial camera SDKs is not currently implemented.

### Segmentation

The current product-segmentation approach can be affected by unusual background conditions or objects appearing near the image border.

### Processing performance

Feature extraction and distance calculations currently run on the browser's main thread. Higher inspection rates may therefore affect UI responsiveness.

### Image storage

Inspection images can currently be stored as encoded image data. A production deployment would benefit from dedicated object storage instead of storing large image payloads directly with inspection metadata.

---

## Future Scope

Potential improvements include:

- Pretrained CNN / Vision Transformer feature embeddings
- ONNX-based browser inference
- Web Worker-based computer-vision processing
- More robust product segmentation
- Industrial camera integration
- Dedicated image/object storage
- Conveyor and PLC integration
- More detailed defect classification
- Expanded production analytics
- Improved high-throughput inspection

---

# 9. Team Members

| Team Member | 
|---|
| **[Anuj Jha]** | 
| **[Sushmita Devkar]** | 
| **[Chandan Gupta]** | 
| **[Yash Patne]** | 

---

# 10. Project Information

| Field | Details |
|---|---|
| **Project Title** | VisionQC |
| **Problem Statement** | [VisionQC] |
| **Selected Domain** | [Ai/ML] |
| **Team Name** | [FourBit] |

---

# 11. GitHub Repository

**Repository:** `github.com/Susysha/FourBit-VisionQC>`

The repository contains the complete project source code, configuration, and documentation required to run the application locally.

---

<div align="center">

**VisionQC**

*Computer Vision • Anomaly Detection • Quality Control*

</div>
