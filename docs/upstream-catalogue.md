# Upstream catalogue

Rather than build and maintain another hardware catalogue from scratch, RackDown uses device data derived from the [NetBox Community Device Type Library](https://github.com/netbox-community/devicetype-library).

Its contributors already do the hard work of maintaining device identities, heights and endpoint definitions, which gives us a much better starting point for optional enrichment. RackDown reuses that work with its original provenance intact. We did not create the upstream data, or modify it.

## Licences and where the data came from

RackDown's own project code is licensed under [AGPL-3.0-only](../LICENSE). The pinned upstream device data is **CC0-1.0**, and we keep its original [licence text](../upstream/netbox/LICENSE.txt) separately. Our licence does not replace or re-label the upstream data.

The [lock record](../upstream/netbox.lock.json) records the upstream source, exact commit, licence and licence blob. The current pin is:

```text
f2d95de24cb3bdd780b93bd7d46d489be3789a8a
```

The [curated manifest](../upstream/netbox.devices.json) records the selected paths, canonical slugs and source blob hashes used by the small local catalogue. Vendored YAML and the upstream licence are kept byte-for-byte.

Normal RackDown use does not contact NetBox or download whatever happens to be current upstream. We deliberately build from committed data tied to the pin above, so an ordinary build should not change just because the upstream library changed overnight.

## What we keep locally

There are currently two catalogue products under `packages/rackdown-devices/generated/`. They use the same compact device semantics, and core accepts their `DeviceIndex` without needing to know where the data came from or how it was loaded.

Unknown devices and endpoints still work with either catalogue. The catalogue is enrichment, not a requirement for a valid RackDown document.

### Small curated index

The curated index currently contains three devices:

- Dell PowerEdge R740;
- Ubiquiti UniFi Dream Machine Pro; and
- Ubiquiti UniFi Switch Pro HD 24 PoE.

We use this small set in tests and the browser playground because dragging the complete upstream library into every small test would be a fairly silly way to prove that three devices work.

From the project root:

```bash
pnpm devices:generate
```

This is a network-free command. `tools/devices/generate-index.mjs`, `generate.mjs` and `normalize.mjs` produce `device-index.json`, `index.mjs` and `catalogue-source.mjs`. The source file carries the locked source, ref and licence metadata alongside the generated catalogue.

`pnpm check` verifies the vendored source and licence blobs, regenerates the curated output and compares it byte-for-byte with what is committed.

### Full offline catalogue

`catalogue-payload.b64` contains the complete normalised device index and the pinned upstream rack definitions as a gzip/base64 payload. The Obsidian build embeds this committed payload so it can use the full catalogue without needing a network connection.

The supported `@rackdown/devices/full-catalogue.b64` asset export exposes the encoded payload. The `@rackdown/devices/full-catalogue` entry point provides:

```text
fullCatalogueSource
parseCataloguePayload(value)
decodeCataloguePayload(encoded)
CatalogueProvider
```

`CatalogueProvider` lazily decodes and caches the payload, then exposes `load()` and `deviceIndex()`.

The browser-oriented decoder currently uses the platform `DecompressionStream`, `atob`, `Blob` and `Response` APIs, so we do not need another runtime dependency just to unpack the catalogue. A host supplies the asset text; importing the module does not fetch it automatically.

For example, a Node build can resolve `@rackdown/devices/full-catalogue.b64` with `import.meta.resolve` and read that URL. A browser host can serve the same asset and pass its text to the decoder. Node builds can also use native gzip decoding and then call `parseCataloguePayload`.

Whichever route a host uses, the payload is checked for the expected schema, source/ref, scope and device index before it is accepted.

## Regenerating the full catalogue

The full payload is not regenerated during a normal build. Updating it requires a separate complete checkout of the upstream library at the exact locked commit:

```bash
node tools/devices/generate-full-catalogue-payload.mjs <upstream-checkout>
```

The generator checks that the checkout is on the expected `HEAD` and rejects tracked changes, untracked files and ignored files. Generation also uses an explicit code-unit sort order and gzip output without a timestamp so that the result is reproducible rather than depending on whoever happened to run it.

To verify the full payload without overwriting the committed copy:

```bash
pnpm devices:verify-full -- <upstream-checkout>
```

This regenerates the payload in memory and compares the complete encoded bytes with the committed file. A wrong revision, dirty checkout or byte mismatch fails the check. It does not fetch upstream data on your behalf.

The standalone catalogue-integrity workflow runs this full verification against the pinned upstream revision on both Ubuntu and Windows. We still use the pinned generator and verification tooling as the authority rather than assuming compressed output will be portable just because it usually is.

`pnpm check` covers the same verification behaviour with small synthetic Git checkouts and validates the committed payload's source and schema. It does not require a complete upstream checkout, and `pnpm devices:generate` only regenerates the curated catalogue.

Please do not hand-edit either generated catalogue. That path leads to a very boring afternoon trying to work out why the bytes no longer agree.

Normal build and development commands consume the committed catalogue files without regeneration or upstream network access. Catalogue generation is an explicit maintenance job.

## Updating the catalogue

Adding one curated device at the existing pin is intentionally a small change. Add its path, canonical slug and blob hash to the manifest, copy the exact pinned YAML, regenerate the curated files and review the source and generated diff. Keep the manifest sorted by canonical slug.

Moving the upstream pin is a larger change because it can alter much more than the device we happened to be interested in. Right now we treat that as its own reviewable update:

1. Choose an exact upstream commit and review its changes and licence.
2. Update the lock, selected source blobs and vendored files together.
3. Regenerate both catalogue products from that revision.
4. Review the generated changes, run `pnpm check`, and run full verification against the clean checkout used for generation.
5. Submit the pin, provenance, inputs and generated changes together for review.

The point is to avoid adding one switch and accidentally swallowing a completely unrelated upstream catalogue change along with it.

## What we keep from upstream

RackDown currently keeps the pieces of upstream data that are useful for rack documentation: canonical slugs, manufacturer, model, part number, U-height, reliable full-depth metadata, airflow and relevant endpoint information.

Endpoint facts can include kind/type, management-only status, PoE mode/type and conservative aliases. We do not pass the complete NetBox schema through core, and we do not currently turn those facts into power, thermal, network or hardware-fit rules.

Aliases are kept deliberately conservative. We do not mine labels or comments and then guess that something called `uplink`, `wan`, `lan` or `nic1` must map to a particular physical port. Quoted endpoint names preserve spaces, and explicit `adhoc` gives the author a way to describe real installed hardware that is missing from a typical device definition.

`createDeviceCatalogue(index)` provides device and endpoint lookup/search over a curated, full or custom compatible index. Discovery is there to help people find canonical names and available endpoint information. It does not change how core resolves the RackDown source.

See the [specification](specification.md) for the current endpoint matching rules and how we handle author intent.
