# ClinVar's two tables, as this builder reads them

ClinVar's data terms are NCBI's, https://www.ncbi.nlm.nih.gov/home/about/policies/. Everything below was read from
`ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/` on 2026-10-12.

## The files

- `archive/variant_summary_YYYY-MM.txt.gz`: one monthly file, kept by NCBI, filed on the first of its month. 450.7 MB
  for 2026-10, 9.2 million lines and 4 GB unpacked. A version is built from one and is labelled by its month.
- `variant_summary.txt.gz`, one level up, is replaced every Monday and archived nowhere (455.8 MB on 2026-10-12, not
  the 2026-10 archive's bytes). This builder never reads it.
- `hgvs4variation.txt.gz`: the current snapshot only, 535.9 MB, 46.2 million rows. NCBI keeps no earlier one, so the
  release keeps the snapshot a version was built from. It is newer than the month's archive: 27 Lynch variations of
  the 2026-10-11 snapshot are not in `variant_summary_2026-10`, and are skipped.

## The columns

- `variant_summary` has a header line starting `#AlleleID`. It grew from 34 columns (2022) to 43 (2026), appended
  at the end, so the builder reads by name. `SCVsForAggregateGermlineClassification` is absent from older files;
  without it a row counts `NumberSubmitters` instead.
- `hgvs4variation` starts with `##` and `#`-prefixed lines describing each column, then the header, whose first
  column is `#Symbol` where the prose says `#GeneSymbol`.
- A variation has up to three `variant_summary` lines, one for each `Assembly`: `GRCh38`, `GRCh37` and `na`. The
  builder takes the classification from GRCh38, else GRCh37, else the `na` line.
- `Type` in `hgvs4variation` is `coding`, `genomic` or `non-coding`, with a comma and a complexity after it for an
  allele made of several (`coding, Haplotype`). Whatever `Type` says, only the form of the expression makes a key.
- `SCVsForAggregateGermlineClassification` separates SCVs with `|`; `-` is none.
- `LastEvaluated` is `Mon DD, YYYY`, or `-`.
