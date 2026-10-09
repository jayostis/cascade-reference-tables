Feature: Detection by folder listing
  A source detected by `tables:FolderListing` names the publisher's folder of release folders (`tables:folderListing`),
  each kind of release folder by a name pattern whose one group is a year, the day it takes effect and a year offset,
  and each file it reads by its name and a pattern for it, with the pattern of the zips that may hold it. A release
  folder is in effect from its day; each file is taken from the newest folder in effect that has a file matching it,
  or a zip matching its archive's. The files taken are the release's inputs, each with the time the listing gives it.

  The examples' source is the example builder's, detected by a folder listing at `https://publisher.example/releases/`:
  its files `codes.txt`, in a zip, and `notes.txt`. The folder `2026` takes effect on 2025-10-01 and holds both;
  `2026-update`, on 2026-04-01, holds only the codes; `2027`, on 2026-10-01, holds both.

  Rule: H16. Each file is taken from the newest release folder in effect that has it, and is new until a version records it as listed

    Example: a check takes each file from the newest folder in effect that has it, and leaves a folder not yet in effect
      Given the publisher's folders list each file at "1/15/2026  9:25 AM"
      When the example source, detected by its folder listing, is checked on "2026-07-01"
      Then the check finds a new release labelled "2026-04-01"
      And the check took "codes-april-2026.zip, notes-2026.txt"

    Example: files listed at the times a version records are nothing new, and nothing is downloaded
      Given the publisher's folders list each file at "1/15/2026  9:25 AM"
      And the example source, detected by its folder listing, is built from the publisher on "2026-07-01"
      When the example source, detected by its folder listing, is checked on "2026-07-01"
      Then the check finds nothing new
      And the check downloaded nothing

    Example: a file listed at a new time is new
      Given the publisher's folders list each file at "1/15/2026  9:25 AM"
      And the example source, detected by its folder listing, is built from the publisher on "2026-07-01"
      And the publisher's folders list each file at "2/2/2026  3:10 PM"
      When the example source, detected by its folder listing, is checked on "2026-07-01"
      Then the check finds a new release labelled "2026-04-01"

    Example: a folder that takes effect is new
      Given the publisher's folders list each file at "1/15/2026  9:25 AM"
      And the example source, detected by its folder listing, is built from the publisher on "2026-07-01"
      When the example source, detected by its folder listing, is checked on "2026-10-01"
      Then the check finds a new release labelled "2026-10-01"
      And the check took "codes-2027.zip, notes-2027.txt"

  Rule: H17. A file no folder in effect has is an error, and a release without exactly one file for a name is refused

    Example: a file no folder in effect has is an error
      Given the publisher's folders list each file at "1/15/2026  9:25 AM"
      When the example source, detected by its folder listing, is checked on "2025-09-30"
      Then the check fails, saying "no release folder in effect"

    Example: a zip lacking the file is refused
      Given the publisher's folders list each file at "1/15/2026  9:25 AM", their zips lacking the codes
      When the example source, detected by its folder listing, is built from the publisher on "2026-07-01"
      Then the build is refused, saying "the release has 0 files for codes.txt"
      And nothing was written
