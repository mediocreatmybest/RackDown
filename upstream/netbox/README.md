# Pinned NetBox snapshot

These files come from the
[NetBox Community Device Type Library](https://github.com/netbox-community/devicetype-library),
whose contributors maintain the upstream hardware definitions.

The [manifest](../netbox.devices.json) selects the YAML files at the exact commit
in the [lock record](../netbox.lock.json). The YAML and [CC0-1.0 licence](LICENSE.txt)
are copied byte-for-byte, not hand-maintained RackDown source.

Keep the lock, manifest, vendored files and generated curated output in sync when
updating the snapshot. The full catalogue uses a separate complete checkout;
this directory contains only selected devices. See
[Upstream catalogue](../../docs/upstream-catalogue.md) for generation, verification
limits and the separate RackDown licence.
