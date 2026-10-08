Feature: Naming a version
  A version is named by cascade-vocabulary's N12: N3's contentName (RDFC-1.0 canonical N-Quads, `ni:///sha-256;`)
  over exactly `<urn:cascade:this-version> prov:specializationOf` its series, `<urn:cascade:this-version>
  prov:wasRevisionOf` the version it revises when there is one, and its rows. A name checked by the code that made it
  proves little: each name below was computed by cascade-runtime-js.

  The example builder is `fixtures/builder/`; its releases are in its `fixtures/`.

  Rule: H1. A version is named from its series, the version it revises and its rows

    Example: each case of the vocabulary's table versions has the name it states
      Then each case of the vocabulary's tests/table-versions/cases.json has its name

    Example: a series is named from the rows its first release gives
      When the example builder's release "release" is built as "1"
      Then "Example vaccine names" is at "ni:///sha-256;5j7QOvdRCtsVe9MXPpFgeazELN7P7OfYeSfjyp5VSkI"
