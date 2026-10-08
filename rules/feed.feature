Feature: The feed
  `feed/feed.ttl` is a DCAT 3 catalog, checked by `shapes/feed.shapes.ttl`. Its IRIs are relative, so it names no
  host. Each build of the examples happens at its own time: the first on 2026-10-01 at 00:00 UTC, the second a day later.

  The example builder is `fixtures/builder/`.

  Rule: H6. The feed keeps every version, and a series' current version is its newest

    Example: after two releases each series has two versions, the second current
      When the example builder's release "release" is built as "1"
      And the example builder's release "release-2" is built as "2"
      Then each series has the versions "1" and "2", and "2" is current
      And what the feed stated of each version "1" is unchanged
      And the catalog was modified at 2026-10-02T00:00:00Z
      And the feed conforms to its shapes

  Rule: H7. A version's rows file holds its rows in the graph named by the version, gzipped alike on every system, and is named by its checksum

    Example: the first release's rows files
      When the example builder's release "release" is built as "1"
      Then each version's rows file is named rows/<its SHA-256 in hex>.nq.gz, and its checksum is that hex
      And each rows file's gzip header has no time and the OS byte 255
      And each rows file holds its version's rows in the graph named by the version, and nothing else
