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
        | one key given twice with different triples    | [{"series": "urn:uuid:6e9c1dc9-8c36-49a8-929c-cd9f6701076c", "subject": "http://hl7.org/fhir/sid/cvx/88", "prefLabel": "flu", "notation": "88"}, {"series": "urn:uuid:6e9c1dc9-8c36-49a8-929c-cd9f6701076c", "subject": "http://hl7.org/fhir/sid/cvx/88", "prefLabel": "influenza", "notation": "88"}]          | is given twice, with different triples                             | release |
        | a release missing a file its source declares  | []                                                                                                                                                                                                                                                                                                              | the release has no codes.txt                                       | missing |
