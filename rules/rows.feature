Feature: Rows
  A builder yields rows in the JSON forms of `builder/interface.schema.json`. The host turns each into RDF and checks it
  against its series' kind's row shape in cascade-vocabulary.

  The example builder is `fixtures/builder/`; its series are "Example vaccine groups" (`rec:VaccineGroups`), "Example
  vaccine names" (`rec:CodeNames`) and "Example vaccine code status" (`rec:CodeStatus`).

  Rule: H2. A mapping row is named by the record rule over its subject, predicate and object (N11)

    Example: 141 is in the group 88
      When the example builder's release "release" is built as "1"
      Then "Example vaccine groups" holds the row "urn:uuid:682b4f66-ad68-80e4-a154-8952fb415368":
        """
        <urn:uuid:682b4f66-ad68-80e4-a154-8952fb415368> a owl:Axiom ;
          owl:annotatedSource <http://hl7.org/fhir/sid/cvx/141> ;
          owl:annotatedProperty skos:broadMatch ;
          owl:annotatedTarget <http://hl7.org/fhir/sid/cvx/88> ;
          sssom:mapping_justification semapv:ManualMappingCuration .
        """

  Rule: H3. A build whose rows the contract refuses writes nothing, and says why

    Scenario Outline: a build is refused: <case>
      When the example builder, given the release "<release>", yields <rows>
      Then the build is refused, saying "<reason>"
      And nothing was written

      Examples:
        | case                                          | rows                                                                                                                                                                                                                                                                                                            | reason                                                             | release |
        | a row failing its kind's shape                | [{"series": "urn:uuid:c1a6678c-2b4d-4287-b852-9039e6a71afd", "subject_id": "http://hl7.org/fhir/sid/cvx/141", "predicate_id": "http://www.w3.org/2004/02/skos/core#exactMatch", "object_id": "http://hl7.org/fhir/sid/cvx/88", "mapping_justification": "https://w3id.org/semapv/vocab/ManualMappingCuration"}] | A vaccine group row puts its code in a group with skos:broadMatch. | release |
        | a names row whose other name is its preferred | [{"series": "urn:uuid:6e9c1dc9-8c36-49a8-929c-cd9f6701076c", "subject": "http://hl7.org/fhir/sid/cvx/88", "prefLabel": "flu", "altLabel": ["flu"], "notation": "88"}]                                                                                                                                           | none its preferred name                                            | release |
        | a row of a series the source does not declare | [{"series": "urn:uuid:00000000-0000-4000-8000-000000000000", "subject": "http://hl7.org/fhir/sid/cvx/88"}]                                                                                                                                                                                                      | is not a series Example vaccine codes declares                     | release |
        | a row in no form of the schema                | [{"series": "urn:uuid:57b9415b-3531-4995-8dfb-48b69ead096f", "code": "88"}]                                                                                                                                                                                                                                     | is no row of builder/interface.schema.json                         | release |
        | a term type row with a field of another form  | [{"series": "urn:uuid:57b9415b-3531-4995-8dfb-48b69ead096f", "subject": "http://hl7.org/fhir/sid/cvx/88", "termType": "SCD", "prefLabel": "flu"}] | is no row of builder/interface.schema.json | release |
        | one key given twice with different triples    | [{"series": "urn:uuid:6e9c1dc9-8c36-49a8-929c-cd9f6701076c", "subject": "http://hl7.org/fhir/sid/cvx/88", "prefLabel": "flu", "notation": "88"}, {"series": "urn:uuid:6e9c1dc9-8c36-49a8-929c-cd9f6701076c", "subject": "http://hl7.org/fhir/sid/cvx/88", "prefLabel": "influenza", "notation": "88"}]          | is given twice, with different triples                             | release |
        | a release missing a file its source declares  | []                                                                                                                                                                                                                                                                                                              | the release has no codes.txt                                       | missing |

  Rule: H26. A classification row is a variation with what its source says of it, and its expressions find it

    Example: the vocabulary's row for variation 90011 in the builder's form gives the vocabulary's Turtle
      Then the vocabulary's tests/vectors/clinvar/row.json gives the row of its row.ttl

    Scenario Outline: a build is refused: <case>
      When the classifications example builder yields <rows>
      Then the build is refused, saying "<reason>"

      Examples:
        | case                                 | rows                                                                                                                                                                                                | reason                                                                  |
        | both submitter counts                | [{"series": "urn:uuid:0a7c93e2-4b1d-4f6a-8e35-9d2c1b7f0a64", "variation": "http://www.ncbi.nlm.nih.gov/clinvar/90011", "contributingSubmitters": 5, "submitters": 5}]                              | is no row of builder/interface.schema.json                              |
        | an empty list of expressions         | [{"series": "urn:uuid:0a7c93e2-4b1d-4f6a-8e35-9d2c1b7f0a64", "variation": "http://www.ncbi.nlm.nih.gov/clinvar/90011", "hgvs": [], "submitters": 5}]                                               | is no row of builder/interface.schema.json                              |
        | an expression IRI holding a raw >    | [{"series": "urn:uuid:0a7c93e2-4b1d-4f6a-8e35-9d2c1b7f0a64", "variation": "http://www.ncbi.nlm.nih.gov/clinvar/90011", "hgvs": ["http://varnomen.hgvs.org/NM_000249.3:c.2042C>T"], "submitters": 5}] | is no row of builder/interface.schema.json                              |
        | an expression that is not a coding one | [{"series": "urn:uuid:0a7c93e2-4b1d-4f6a-8e35-9d2c1b7f0a64", "variation": "http://www.ncbi.nlm.nih.gov/clinvar/90011", "hgvs": ["http://varnomen.hgvs.org/NM_000249.3%3An.1A%3EG"], "submitters": 5}] | A variant classification row is found by coding NM_ expressions         |
        | a classification of no concept       | [{"series": "urn:uuid:0a7c93e2-4b1d-4f6a-8e35-9d2c1b7f0a64", "variation": "http://www.ncbi.nlm.nih.gov/clinvar/90011", "classification": ["https://ns.cascadeprotocol.org/genomics/v1#Maybe"], "submitters": 5}] | A classification is a concept of rec:ClinVarClassifications.            |
        | a second review status               | [{"series": "urn:uuid:0a7c93e2-4b1d-4f6a-8e35-9d2c1b7f0a64", "variation": "http://www.ncbi.nlm.nih.gov/clinvar/90011", "reviewStatus": "https://ns.cascadeprotocol.org/records/v1-draft#ClinVarExpertPanel", "submitters": 5}, {"series": "urn:uuid:0a7c93e2-4b1d-4f6a-8e35-9d2c1b7f0a64", "variation": "http://www.ncbi.nlm.nih.gov/clinvar/90011", "reviewStatus": "https://ns.cascadeprotocol.org/records/v1-draft#ClinVarSingleSubmitter", "submitters": 5}] | is given twice, with different triples |

    Example: one expression on two rows of a version, a chunk of rows apart, is refused naming it
      When the classifications example builder is given 2001 rows, the first and the last found by the expression "NM_000249.3:c.1A>G"
      Then the build is refused, saying "http://varnomen.hgvs.org/NM_000249.3%3Ac.1A%3EG is on two rows, http://www.ncbi.nlm.nih.gov/clinvar/1 and http://www.ncbi.nlm.nih.gov/clinvar/2001"
