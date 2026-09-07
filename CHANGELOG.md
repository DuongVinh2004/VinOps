# Changelog

All notable changes to the **VinOps** platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-09-07

### Added

- **BIM 3D Digital Twin Engine (`ADR-013`)**:
  - Web-IFC background parser and streaming glTF conversion.
  - Spatial element linking to field issues, inspections, and documents.
  - BCF 3.0 viewpoints, topics, and camera snapshot synchronization.
  - Interactive 3D measurement and BIM property inspector panels in React/Vite.
- **AI Computer Vision & RAG Copilot (`ADR-014`)**:
  - Automated crack, rebar exposure, and PPE violation detection.
  - Non-Maximum Suppression (NMS) bounding box filter.
  - Vector embeddings (`pgvector`) for construction codes and building standard retrieval.
  - Two-tier Copilot chat drawer for engineer assistance.
- **PKI Remote Digital Signatures (`ADR-015`)**:
  - 3-party sequential acceptance workflow compliant with NĐ 207/2026/NĐ-CP (Contractor -> TVGS -> PMU).
  - Cloud Signature Consortium (CSC) remote HSM provider adapter (VNPT SmartCA, Viettel Cloud CA, TrustCA).
  - PAdES-LTA visual PDF signature stamps with RFC 3161 Time-Stamp Authority (TSA).
  - As-built electronic dossier assembly with cryptographic hash chain sealing.
- **Realtime Event Streaming & Notifications (`ADR-016`)**:
  - WebSocket gateway with Redis Pub/Sub cluster coordination.
  - Native push notification adapters for Google Firebase Cloud Messaging (FCM) and Apple APNs.
  - Room-based multi-tenant event dispatcher with project security isolation.
- **GIS & Drone Orthophoto Engine (`ADR-017`)**:
  - VN-2000 Vietnamese geodetic datum to WGS-84 coordinate projection converter.
  - Cloud-Optimized GeoTIFF (COG) orthophoto overlay integration.
  - MapLibre GL map container with swipe comparison and spatial annotations.
- **Capacitor Mobile Client Packaging**:
  - Native iOS and Android runtime build configuration.
  - Biometric authentication and native push notification token registration.

### Security & Compliance

- **ER Gate B Runtime Verification**: Full RLS BOLA/IDOR negative security tests proven; ClamAV malware rejection and MinIO quarantine garbage sweep verified.
- **ER Gate C Pilot UAT Validation**: 10/10 offline/online field device simulation scenarios verified across iPad, Galaxy Tab, and iPhone devices.
- **Zero Vulnerabilities**: Pinned toolchain dependencies audited clean with zero high/critical advisories.

---

## [0.2.0] - 2026-08-01

### Added

- Mega-Slice A: Common Data Environment (CDE) and document control baseline.
- Quality acceptance and field inspections (NĐ 207/2026 sequential workflow).
- Corrective Action Request (CAR) Separation of Duties (SoD) engine.
- Daily construction logs with GPS weather integration and freeze constraints.
- Offline synchronization ledger with version conflict detection.

---

## [0.1.0] - 2026-07-30

### Added

- Monorepo foundation (`VIN-FND-001A`) with Node 24 LTS, pnpm 11, and TypeScript 5.9.
- PostgreSQL 17 transaction boundary with least-privilege runtime roles (`vinops_app`, `vinops_worker`).
- Transactional outbox pattern and ClamAV/MinIO file processing pipeline.
- OpenAPI 3.1 contract generation and drift verification.
