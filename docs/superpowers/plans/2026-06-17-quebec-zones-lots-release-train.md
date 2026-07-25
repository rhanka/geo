# Quebec Zones/Lots Release Train Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the maximum useful Quebec zoning and cadastre lot data for immo, progressively and replayably, through the standard `@sentropic/geo` S3 + OGC API path.

**Architecture:** Keep `geo` standard: S3/object-store normalized GeoJSON, OGC API Features collections/items, no immo-specific business rules. The immediate blocker is the eager `StoreProvider`: `/collections` loads all GeoJSON into memory, which prevents serving zones and lot shards together. First make the store provider lazy per collection, then publish zones and lots by shard while tracking/pushing each slice.

**Tech Stack:** TypeScript, Hono OGC API, `StoreProvider` over `S3Store`/`FsStore`, normalized GeoJSON + `.meta.json`, `track` for work state, git main for progressive publishing.

---

### Task 1: Make StoreProvider collection-lazy

**Files:**
- Modify: `packages/geo/src/api/providers/store-provider.ts`
- Modify: `packages/geo/src/api/providers/store-provider.test.ts`
- Track: `.track/events.jsonl`, `.track/head.json`

- [ ] Add a store-backed index that lists `.geojson` keys and reads sibling `.meta.json` files without parsing GeoJSON during `listCollections()`.
- [ ] Resolve collection ids from `meta.datasetId` when present, else the file stem.
- [ ] Load and cache a collection's GeoJSON only when `getItems()` or `getItem()` is called for that collection.
- [ ] Keep `/collections/:id` metadata-only to avoid loading heavy lot shards.
- [ ] Add/adjust hermetic tests so `/collections` does not call `store.get()` for GeoJSON payloads.
- [ ] Update track item `Implement lazy-load/tuilage for lot shards` to done after code is committed.
- [ ] Commit and push `HEAD:main`.

### Task 2: Publish zones and lots through the standard API path

**Files:**
- Inspect/modify only if needed: `deploy/k8s/deployment-api.yaml`, `deploy/k8s/job-fetch.yaml`
- Track: `.track/events.jsonl`, `.track/head.json`

- [ ] Point deploy/runtime data location at a prefix that includes both zonage collections and `qc-lots-*` shards when lazy loading is available.
- [ ] Preserve the ability to scope to zones-only if the runtime lacks memory or credentials.
- [ ] Commit and push `HEAD:main`.

### Task 3: Standard immo handoff

**Files:**
- Create or modify: `docs/immo-zones-lots-handoff.md`
- Track: `.track/events.jsonl`, `.track/head.json`

- [ ] Document the standard API contract: OGC collections, lots by shard, zones by collection, stable ids, `NO_LOT`, municipality metadata, provenance and license.
- [ ] State explicitly that immo owns temporal/business semantics and can start with geometry intersection plus lot ids.
- [ ] Commit and push `HEAD:main`.
