# Code-mismatch SIG↔normes — broad-city (couche « périmé » §3)

- Snapshot: **2026-08-30** — READ-ONLY (bucket `sentropic-geo`, OVH/PROD)
- Canon (deux côtés): `canonZone (acquisition/src/lib/zonage-norms.ts) → delegates verbatim to canonicalizeZoneCodeForJoin (packages/geo/src/zonage/lotZoneJoin.ts)`
- Source normes: deposited parquet registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet, zone_code column (same source as acquisition/src/norms-codes-dump.ts)
- Règle: mismatch(muni) = ∃ code SIG canon SANS code normes canon correspondant (appartenance ensembliste canon; pas de pont numérique de millésime). normes absentes → `source-gap` (mismatch NON évaluable, jamais « 0 mismatch »).

## Synthèse

- **snapshot**: 2026-08-30
- **read_only**: true
- **total_served_munis**: 873
- **deposited_norms_products**: 817
- **munis_scanned**: 873
- **munis_sig_read_error**: 0
- **munis_assessable_mismatch**: 727
- **munis_with_mismatch**: 617
- **munis_no_mismatch**: 110
- **munis_normes_source_gap**: 146
- **canon_used**: canonZone (acquisition/src/lib/zonage-norms.ts) → delegates verbatim to canonicalizeZoneCodeForJoin (packages/geo/src/zonage/lotZoneJoin.ts)
- **normes_source**: deposited parquet registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet, zone_code column (same source as acquisition/src/norms-codes-dump.ts)
- **mismatch_rule**: ∃ canon SIG code with NO matching canon normes code (plain canonical set membership; no numeric-vintage bridge)

## Cas cités (geo-archi)

### repentigny
- normes_source: **deposited** · mismatch: **yes**
- n_sig_codes=469 · n_normes_codes=465 · n_mismatched=5
- SIG codes sans normes correspondante (verbatim): `A1-393`, `A2-301`, `CON1-197`, `P1-447`, `P3-048`

### beaupre
- normes_source: **deposited** · mismatch: **yes**
- n_sig_codes=78 · n_normes_codes=51 · n_mismatched=27
- SIG codes sans normes correspondante (verbatim): `1-Co`, `14-Co`, `16-Co`, `21-H`, `25-P`, `27-H`, `29-H`, `40-P`, `41-P`, `44-H`, `46-P-1`, `46-P-2`, `47-H`, `48-P`, `49-P`, `50-H`, `61-H`, `65-Ri1`, `70-H`, `71-H`, `72-H`, `73-H`, `74-H`, `75-H`, `8-H`, `9-M`, `UNKNOWN`

### mont-tremblant
- normes_source: **deposited** · mismatch: **yes**
- n_sig_codes=626 · n_normes_codes=650 · n_mismatched=1
- SIG codes sans normes correspondante (verbatim): `TM-661`

## Munis avec mismatch (617)

| slug | n_sig | n_normes | n_mismatched | échantillon codes SIG sans normes |
| --- | ---: | ---: | ---: | --- |
| rimouski | 2134 | 8 | 2128 | `0001` `0002` `0003` `0004` `0005` `0006` `0007` `0008` +2120 |
| gatineau | 1871 | 6 | 1870 | `Ag-18-007` `Ag-18-019` `Ag-18-028` `Ag-18-029` `Ag-18-032` `Ag-18-033` `Ag-18-039` `Ag-18-043` +1862 |
| levis | 1716 | 30 | 1687 | `A0001` `A0002` `A0003` `A0004` `A0006` `A0008` `A0010` `A0012` +1679 |
| trois-rivieres | 1664 | 328 | 1336 | `AGF-6121` `AGF-6122` `COR-3047` `COR-3049` `COR-3130` `COR-3131` `COR-3266` `COR-3267` +1328 |
| drummondville | 1222 | 18 | 1204 | `A-5001` `A-5002` `A-5003` `A-5003-1` `A-5004` `A-5005` `A-5006` `A-5007` +1196 |
| rouyn-noranda | 1058 | 35 | 1023 | `1001` `1007` `1018` `1019` `1030` `2009` `2010` `2011` +1015 |
| saint-hyacinthe | 1089 | 1066 | 851 | `10001-H` `10002-H` `10003-H` `10004-A` `10005-A` `10006-A` `10007-A` `10008-H` +843 |
| gore | 823 | 18 | 817 | `A-04` `A-05` `A-06` `A-100` `A-101` `A-102` `A-103` `A-104` +858 |
| longueuil | 1927 | 1164 | 764 | `A12-024 (STH)` `A12-066 (STH)` `A12-074 (STH)` `A12-076 (STH)` `A12-079 (STH)` `A12-087 (STH)` `A15-032 (STH)` `A15-033 (STH)` +756 |
| brossard | 692 | 21 | 692 | `Ax-323` `Ax-649` `Ax-650` `Ax-651` `Ax-652` `Ax-653` `Ax-655` `Ay-319` +684 |
| granby | 762 | 74 | 689 | `CI01A` `DI02R` `DL07P` `DL08P` `DM01R` `DM02R` `DM03P` `EC01C` +681 |
| shawinigan | 678 | 6 | 678 | `A-5000` `A-5001` `A-5002` `A-5003` `A-5004` `A-5005` `A-5006` `A-5100` +670 |
| mirabel | 711 | 50 | 661 | `C-10-14` `C-10-18` `C-10-27` `C-10-29` `C-10-33` `C-10-4` `C-10-55` `C-10-56` +653 |
| saint-georges | 583 | 13 | 581 | `AA-001` `AA-003` `AA-031` `AA-035` `AA-036` `AA-907` `AA-931` `AA-932` +573 |
| thetford-mines | 537 | 399 | 537 | `1002 C` `1003 R` `1004 R` `1005 R` `1006 R` `1007 R` `1008 R` `1009 R` +529 |
| montmagny | 489 | 5 | 486 | `Ab - 2` `Ab - 3` `Ab - 4` `Ab - 5` `Ab - 6` `Ac - 1` `Ac - 10` `Ac - 3` +478 |
| val-dor | 468 | 619 | 468 | `106-Ag` `119-Ad` `120-RU` `121-Agf` `124-Ag` `131-RN` `202-Agf` `204-Ag` +460 |
| sainte-anne-des-monts | 466 | 6 | 463 | `CV.1` `CV.10` `CV.11` `CV.12` `CV.13` `CV.14` `CV.2` `CV.3` +455 |
| saint-jerome | 502 | 114 | 400 | `CUS-922` `CUS-925` `CUS-926` `CUS-927` `CUS-928` `EVR-104` `EVR-129` `EVR-139` +392 |
| boucherville | 463 | 80 | 383 | `A-2004` `A-2005` `A-2007` `A-2008` `A-2009` `A-2010` `A-2012` `A-2013` +375 |
| magog | 354 | 23 | 346 | `A193` `A195` `A323` `A507` `A513` `A519` `A531` `A533` +338 |
| saint-eustache | 321 | 28 | 321 | `1-A-01` `1-C-13` `1-C-14` `1-C-19` `1-C-20` `1-C-21` `1-C-26` `1-C-28` +313 |
| chateauguay | 319 | 1 | 319 | `A-745` `C-113` `C-135` `C-137` `C-200` `C-220` `C-221` `C-222` +311 |
| saint-bruno-de-montarville | 309 | 20 | 309 | `AA-190` `AA-198` `AA-490` `AA-590` `AA-591` `AA-592` `AA-593` `AA-690` +301 |
| mont-laurier | 305 | 1 | 304 | `A-152` `A-158` `A-163` `A-200` `A-201` `A-205` `A-722` `A-731` +296 |
| farnham | 299 | 173 | 299 | `A-001` `A-002` `A-003` `A-004` `A-005` `A-006` `A-007` `A-008` +291 |
| la-prairie | 306 | 26 | 296 | `A-802` `A-803` `A-804` `A-805` `C-022` `C-029` `C-030` `C-031` +288 |
| bromont | 290 | 5 | 290 | `A01-109` `A01-110` `A01-120` `A01-121` `A01-122` `A01-123` `A01-124` `A01-125` +282 |
| temiscouata-sur-le-lac | 288 | 3 | 285 | `Ca-1` `Ca-2` `Ca-3` `Ca-4` `Ca-5` `Cb-1` `Cb-12` `Cb-13` +277 |
| joliette | 364 | 93 | 281 | `A05-023` `A05-024` `A05-025` `C02-002` `C02-008` `C02-010` `C02-011` `C02-022` +273 |
| alma | 1059 | 876 | 255 | `Ab1` `Ab10` `Ab11` `Ab12` `Ab2` `Ab3` `Ab4` `Ab5` +247 |
| boisbriand | 302 | 55 | 253 | `A 321` `A 322` `A 323` `A 324` `A 325` `A 326` `A 421` `A 442` +245 |
| matane | 248 | 40 | 248 | `10-P` `101-C` `102-R` `103-R` `104-C` `105-C` `107-P` `11-R` +240 |
| chandler | 296 | 58 | 243 | `1001-Af` `1002-F` `1003-F` `1004-F` `1005-F` `1006-F` `1007-F` `1008-F` +235 |
| baie-saint-paul | 316 | 80 | 237 | `AD-346` `AD-349` `AD-355` `AD-356` `AD-362` `AD-363` `AD-367` `AD-368` +229 |
| brownsburg-chatham | 237 | 21 | 237 | `A-101` `A-102` `A-103` `A-104` `A-105` `A-106` `A-107` `A-110` +229 |
| amqui | 227 | 228 | 227 | `1 Cp` `10 Ib` `101 Ha` `102 Ha` `103 Hc` `104 Cc` `105 Ha` `106 Ha` +219 |
| riviere-du-loup | 222 | 44 | 220 | `A-201` `A-202` `A-203` `A-204` `A-205` `A-206` `A-207` `A-301` +212 |
| lac-brome | 194 | 7 | 194 | `A-1-J14` `AF-1-H2` `AF-10-H6` `AF-11-K8` `AF-12-F8` `AF-13-H8` `AF-14-B10` `AF-15-C9` +186 |
| perce | 194 | 41 | 194 | `001-F` `001.1-Cn` `002-Af` `002.1-Af` `002.2-Af` `003-M` `004-Rec` `005-Ha` +186 |
| beauceville | 193 | 2 | 193 | `1-F` `10-IDSAR` `101-A` `102-IDSM` `103-ID` `104-ID` `105-F` `106-A` +185 |
| saint-ferdinand | 234 | 103 | 193 | `104-P` `106-P` `107-P` `110-P` `112-P` `114-P` `116-P` `117-P` +186 |
| candiac | 218 | 35 | 192 | `A-426` `A-427` `A-429` `A-430` `A-431` `A-603` `A-604` `A-605` +184 |
| saint-colomban | 189 | 2 | 189 | `A2-062` `A2-137` `A2-163` `C-167` `C-170` `C-171` `C-173` `C-174` +181 |
| riviere-rouge | 183 | 159 | 183 | `A-01` `A-02` `A-03` `A-04` `A-05` `A-06` `A-07` `A-08` +175 |
| ville-marie | 193 | 40 | 173 | `Ca13` `Ca15` `Ca16` `Ca17` `Ca18` `Ca19` `Ca2` `Ca20` +166 |
| saint-apollinaire | 173 | 22 | 167 | `100R` `102C` `103C` `104I` `105I` `106P` `108.1L` `108L` +159 |
| piedmont | 156 | 47 | 156 | `C-200` `C-207` `C-211` `C-212` `C-215` `C-217` `C-230` `C-231` +148 |
| westmount | 159 | 8 | 154 | `C1-24-01` `C1-24-03` `C1-27-07` `C1-34-05` `C1-34-11` `C10-24-06` `C14-31-01` `C15-24-07` +146 |
| la-malbaie | 222 | 80 | 152 | `A-1102` `A-1103` `A-1104` `A-1105` `A-1402` `A-1403` `A-1514` `A-1515` +144 |
| berthierville | 154 | 4 | 151 | `1-A-01` `1-A-04` `1-C-02` `1-C-03` `1-C-06` `1-C-07` `1-C-08` `1-C-09` +143 |
| saint-joseph-de-beauce | 151 | 3 | 151 | `A-100` `A-102` `A-103` `A-104` `A-109` `A-111` `A-112` `A-113` +143 |
| contrecoeur | 164 | 15 | 149 | `C1-159` `C1-66` `C10-25` `C3-39` `C3-48` `C3-52` `C3-58` `C4-53` +141 |
| stoneham-et-tewkesbury | 149 | 2 | 148 | `AG-301` `AG-302` `AG-303` `AG-304` `AG-305` `AG-306` `AG-415` `AG-416` +140 |
| sainte-catherine | 190 | 50 | 147 | `C-211` `C-220` `C-222` `C-304` `C-448` `C-461` `C-464` `C-490` +139 |
| lac-megantic | 178 | 36 | 142 | `A-2` `A-21` `A-23` `A-3` `A-4` `A-5` `AF-20` `AF-21` +134 |
| nicolet | 183 | 42 | 142 | `A03-302` `A04-402` `A04-403` `A04-404` `A04-405` `A04-406` `A04-407` `A04-418` +134 |
| notre-dame-du-mont-carmel | 142 | 49 | 142 | `101-REC` `102-AF` `103-RU` `104-AF` `105-1-A` `105-2-A` `105-3-A` `105-A` +134 |
| adstock | 173 | 52 | 138 | `M1.1-1` `M1.1-10` `M1.1-11` `M1.1-2` `M1.1-3` `M1.1-4` `M1.1-5` `M1.1-6` +130 |
| saint-constant | 152 | 17 | 138 | `A-701` `A-702` `A-710` `A-711` `A-732` `C-115` `C-204` `C-427` +130 |
| berthier-sur-mer | 134 | 1 | 134 | `Aa.1` `Aa.2` `Aa.3` `Aa.4` `Aa.5` `Aa.6` `Aa.7` `Aa.8` +126 |
| saint-armand | 143 | 27 | 129 | `A-1` `A-2` `A-3` `A-4` `A-5` `A-6` `C-3` `I-2` +121 |
| la-peche | 167 | 40 | 128 | `A-002` `A-003` `A-004` `A-005` `A-006` `A-007` `A-008` `A-009` +120 |
| becancour | 126 | 17 | 125 | `A01-102` `A01-104` `A01-107` `A02-201` `A02-205` `A02-253` `A02-258` `A02-265` +117 |
| saint-germain-de-grantham | 124 | 1 | 123 | `A-1` `A-10` `A-11` `A-12` `A-13` `A-14` `A-15` `A-16` +115 |
| sainte-adele | 135 | 33 | 121 | `CE - 001` `CE - 002` `CE - 003` `CE - 004` `CE - 005` `CE - 006` `CI - 001` `CI - 002` +113 |
| lanoraie | 127 | 31 | 120 | `A1` `A10` `A11` `A12` `A13` `A15` `A19` `A2` +112 |
| vercheres | 120 | 118 | 120 | `A-1` `A-10` `A-2` `A-3` `A-4` `A-5` `A-6` `A-7` +112 |
| saint-jean-de-matha | 119 | 1 | 118 | `P1-2` `P1-4` `P1-5` `P1-7` `P10-2` `P2-1` `P2-2` `P2-3` +110 |
| rawdon | 119 | 20 | 117 | `CV-1` `CV-10` `CV-11` `CV-13` `CV-14` `CV-15` `CV-16` `CV-18` +109 |
| saint-charles-borromee | 136 | 57 | 117 | `A79` `A89` `A90` `A94` `A95` `C102` `C102a` `C104` +109 |
| saint-andre-dargenteuil | 122 | 37 | 116 | `A-101` `A-102` `A-103` `A-104` `A-105` `A-105.1` `A-106` `A-107` +108 |
| plessisville | 115 | 4 | 115 | `100 I` `101 I` `102 R` `103 R` `104 R` `105 R` `106 I` `107 R` +107 |
| potton | 113 | 1 | 112 | `A-1` `A-2` `A-3` `A-4` `A-5` `A-6` `A-7` `A-8` +104 |
| saint-antoine-de-tilly | 111 | 64 | 111 | `AAa 31` `AAa 32` `AAa 34` `AAa 44` `AAb 20` `AAb 22` `AAb 23` `AAb 24` +103 |
| ormstown | 114 | 16 | 109 | `A-1` `A-2` `A-3` `A-4` `A-5` `AC-1` `AC-2` `AC-3` +101 |
| sainte-julie | 111 | 26 | 109 | `C-137` `C-149` `C-150` `C-202` `C-242` `C-245` `C-248` `C-249` +101 |
| val-des-sources | 154 | 50 | 109 | `100-A` `101-Rec` `102-R` `103-R` `104-R` `105-R` `106-R` `107-R` +101 |
| saint-hippolyte | 112 | 29 | 106 | `A-500` `A-501` `A-502` `C-103` `C-109` `C-112` `C-114` `C-115` +98 |
| sainte-catherine-de-la-jacques-cartier | 164 | 59 | 106 | `100-H` `101-H` `102-H` `103-REC` `104-F` `105-CN` `106-CN` `107-CN` +98 |
| lisle-aux-coudres | 104 | 4 | 104 | `AD-301` `AD-302` `AD-303` `AD-304` `AD-306` `AD-308` `AD-313` `AD-318` +96 |
| mont-blanc | 101 | 3 | 101 | `Ca-707` `Ca-710` `Ca-712` `Ca-723` `Ca-724` `Ca-725` `Ca-740` `Cv-7` +93 |
| albanel | 106 | 8 | 100 | `A100` `A101` `A102` `A103` `A104` `A105` `A106` `A106 (1)` +93 |
| sainte-anne-de-la-perade | 100 | 3 | 100 | `101-CR` `102-CR` `103-R` `104-R` `105-R` `106-CR` `107-R` `108-R` +92 |
| notre-dame-des-prairies | 155 | 102 | 99 | `A-1 130` `A-1 131` `A-1 132` `A-1 133` `A-1 134` `A-1 135` `A-1 136` `A-1 137` +91 |
| sorel-tracy | 728 | 639 | 98 | `A-02-509` `C-01-57` `C-01-69` `C-02-545` `H-01-327` `I-01-15` `P-01-04` `P-01-05` +90 |
| varennes | 249 | 151 | 98 | `A-101` `A-102` `A-103` `A-104` `A-106` `A-107` `A-309` `A-627` +90 |
| carignan | 142 | 64 | 97 | `A-023` `A-024` `A-025` `A-027` `A-131` `A-132` `A-133` `A-135` +89 |
| sainte-julienne | 97 | 5 | 97 | `A-1-101` `A-1-102` `A-2-103` `A-3-104` `A-3-105` `A-4-106` `A-4-107` `A-5-108` +89 |
| saint-anselme | 111 | 15 | 96 | `107 R` `117 R` `118 R` `119 R` `120 R` `121 R` `122 R` `123 R` +88 |
| saint-romain | 94 | 16 | 94 | `A-10` `A-11` `A-12` `A-13` `A-14` `A-15` `A-16` `A-17` +86 |
| acton-vale | 93 | 5 | 90 | `106` `107` `108` `110` `113` `114` `115` `116` +82 |
| fossambault-sur-le-lac | 89 | 1 | 89 | `01-P` `02-REC` `03-H` `04-C` `05-P` `06-H` `07-H` `08-RF` +81 |
| saint-come | 89 | 1 | 89 | `103` `105` `105-1` `105-2` `106` `106-1` `107` `107-1` +81 |
| scott | 89 | 103 | 89 | `A-1` `A-10` `A-11` `A-12` `A-13` `A-2` `A-3` `A-4` +81 |
| otterburn-park | 98 | 20 | 87 | `A-85` `C-23` `C-41` `C-68` `C-79` `C-93` `Cons-26` `Cons-46` +79 |
| saint-honore | 87 | 45 | 87 | `100-Av` `108-Af` `109-Adé` `111-Af` `13-Adé` `14-Id` `15-Av` `16-Av` +79 |
| roxton-pond | 85 | 4 | 85 | `A-1` `A-2` `A-3` `AC-1` `AC-2` `AF-1` `AF-2` `AF-3` +77 |
| ascot-corner | 105 | 38 | 84 | `A-1` `A-2` `A-3` `A-4` `A-5` `A-6` `A-7` `C-1` +77 |
| saint-gabriel-de-brandon | 84 | 21 | 84 | `101` `102` `103` `104` `105` `106` `107` `108` +76 |
| saint-paul | 88 | 27 | 84 | `A100` `A101` `A102` `A103` `A104` `A105` `A106` `A107` +76 |
| lambton | 89 | 7 | 82 | `A-1` `A-10` `A-11` `A-12` `A-13` `A-14` `A-15` `A-16` +74 |
| sainte-sophie | 105 | 36 | 82 | `A-100` `A-101` `A-102` `A-103` `A-104` `A-105` `A-106` `A-107` +74 |
| saint-etienne-des-gres | 81 | 36 | 81 | `100` `103` `107` `108` `109` `111` `112` `117` +73 |
| saint-maurice | 81 | 3 | 81 | `101-R` `102-R` `103-R` `104-P` `105-R` `106-R` `107-R` `108-R` +73 |
| cote-saint-luc | 249 | 182 | 80 | `CA-4` `CD-12` `Centre commercial` `Commerce automobile` `Commerce de détail et de services` `Commerce récréatif` `Culture, religion, éducation, santé` `Emprises publiques` +72 |
| lac-sainte-marie | 86 | 56 | 80 | `AD-2` `AD-4` `AD-6` `AD-7` `AD-8` `AD-9` `AF-3` `CONS-3` +72 |
| chute-aux-outardes | 79 | 44 | 79 | `A67` `A68` `C10` `C11` `C12` `C13` `C14` `C15` +71 |
| grande-riviere | 82 | 60 | 79 | `C-2` `I-1` `I-2` `I-3` `I-4` `I-5` `I-6` `M-1` +71 |
| low | 78 | 1 | 78 | `14-A` `14-B` `15-A` `16-A` `19-A` `19-B` `21-A` `21-B` +70 |
| mont-joli | 211 | 165 | 78 | `101 (AGC)` `102 (AGC)` `103 (CMC)` `104 (CMC)` `105 (CMC)` `106 (CMC)` `107 (CMC)` `108 (CMC)` +70 |
| saint-chrysostome | 78 | 5 | 78 | `A-1` `A-2` `A-3` `AC-1` `AD-1` `AD-2` `AD-3` `AD-4` +70 |
| saint-mathias-sur-richelieu | 78 | 13 | 76 | `A-1` `A-10` `A-11` `A-12` `A-13` `A-14` `A-15` `A-16` +68 |
| disraeli--les-appalaches--2 | 82 | 10 | 75 | `1 - R` `11 - R` `12 - R` `13 - RC` `14 - C` `15 - R` `16 - C` `17 - RC` +68 |
| saint-christophe-darthabaska | 75 | 4 | 75 | `A1` `A10` `A11` `A12` `A13` `A14` `A15` `A16` +67 |
| saint-felix-de-valois | 99 | 38 | 75 | `AGD-2` `AGD-3` `AGD-5` `AGD-6` `AGV-2` `AGV-4` `AGV-5` `AGV-7` +67 |
| dollard-des-ormeaux | 86 | 31 | 74 | `P-112` `P-114` `P-116` `P-302` `P-304` `P-306` `P-308` `P-310` +66 |
| lac-simon | 74 | 57 | 73 | `1-REC` `10-FO` `11-V` `12-V` `13-V` `14-V` `15-V` `17-V` +65 |
| sainte-melanie | 73 | 48 | 73 | `A-03` `A-08` `A-11` `A-12` `A-15` `A-21` `A-52` `A-59` +65 |
| lorrainville | 74 | 20 | 71 | `A100` `A200` `A307` `A309` `A412` `Aa1` `Aa2` `Aa3` +63 |
| pointe-lebel | 71 | 22 | 71 | `A55` `A56` `A57` `A58` `A59` `A60` `A61` `A62` +63 |
| saint-fabien-de-panet | 71 | 12 | 71 | `Ab.1` `Ac.1` `Ac.2` `Ac.3` `Cb.1` `CcM.1` `Fc.1` `Fc.10` +63 |
| hinchinbrooke | 74 | 4 | 70 | `Aa-1` `Aa-2` `Aa-3` `Aa-4` `Aa-4-1` `Aa-5` `Aa-6` `Aa-7` +62 |
| pont-rouge | 77 | 84 | 70 | `Ad-400` `Ad-401` `Ad-402` `Ad-403` `Ad-404` `Ad-407` `Ad-409` `Ad-410` +62 |
| cap-saint-ignace | 76 | 7 | 69 | `Aa.1` `Ac.1` `Ac.5` `Ac.6` `Ac.7` `Ac.8` `Ac.9` `CaMP.1` +61 |
| lac-beauport | 149 | 80 | 69 | `CS-426` `CS-427` `CS-428` `CS-429` `F-401` `F-402` `F-403` `F-404.1` +61 |
| laverlochere-angliers | 79 | 41 | 69 | `12` `A1` `Aa1` `Aa2` `Aa3` `Aa4` `Aa5` `Aa6` +63 |
| la-pocatiere | 208 | 142 | 67 | `10AF` `10ID` `11AF` `11ID` `12ID` `13ID` `14ID` `15ID` +59 |
| lavenir | 68 | 1 | 67 | `A1` `A2` `A3` `A4` `A5` `A6` `AP1` `AP2` +59 |
| tingwick | 69 | 3 | 66 | `A1` `A10` `A2` `A3` `A4` `A5` `A6` `A7` +58 |
| la-presentation | 65 | 6 | 65 | `505` `507` `508` `512` `8022 M10` `8028  A21` `8029  A21` `8031  A21` +57 |
| sainte-clotilde-de-horton | 65 | 13 | 65 | `A1` `A10` `A11` `A12` `A13` `A14` `A15` `A16` +57 |
| saint-basile-le-grand | 90 | 26 | 64 | `150-C` `151-C` `152-C` `153-C` `154-I` `155-H` `156-H` `157-H` +56 |
| saint-tite-des-caps | 66 | 2 | 64 | `Ad-11` `Ad-12` `Ad-14` `Ad-16` `Ad-18` `Ad-42` `Ad-52` `Ad-61` +56 |
| kinnears-mills | 67 | 4 | 63 | `AF1a 1` `AF1a 2` `AF1a 3` `AF1b 1` `AF1b 2` `AF2a 1` `AF2a 2` `AF2a 3` +55 |
| saint-gabriel | 64 | 3 | 63 | `C-06` `C-08` `C-09` `C-15` `C-28` `C-34` `C-34-1` `C-34-2` +55 |
| armagh | 61 | 1 | 61 | `A-150` `A-151` `A-152` `A-153` `AF-162` `AF-163` `AF-164` `AF-70` +53 |
| esterel | 66 | 6 | 61 | `P 1` `P 2` `P 3` `PC-1` `PC-10` `PC-11` `PC-12` `PC-13` +53 |
| saint-david-de-falardeau | 61 | 144 | 61 | `A-308` `A-309` `A-310` `A-311` `A-315` `A-316` `A-317` `A-319` +53 |
| saint-gabriel-de-valcartier | 62 | 2 | 61 | `A-1` `A-2` `A-3` `A-4` `A-5` `C-1` `Ex-1` `Ex-2` +53 |
| saint-thomas | 61 | 62 | 61 | `01` `02` `03` `04` `05` `06` `07` `08` +53 |
| wickham | 74 | 24 | 61 | `AD-1` `AD-10` `AD-11` `AD-2` `AD-3` `AD-4` `AD-5` `AD-6` +53 |
| degelis | 123 | 63 | 60 | `MA-1` `MA-2` `MB-1` `MB-2` `MC-1` `MC-2` `MD-1` `MD-2` +52 |
| lile-danticosti | 62 | 16 | 59 | `A-1` `CS-1` `CS-2` `CS-3` `CS-4` `Ca-1` `Ca-2` `Ca-3` +51 |
| pointe-aux-outardes | 59 | 2 | 59 | `1-A` `1-Ad` `1-Cn` `1-F` `1-I` `1-M` `1-P` `1-Rec` +51 |
| saint-agapit | 81 | 22 | 59 | `I-21` `I-22` `I-23` `M-41` `M-42` `M-43` `M-44` `M-45` +51 |
| saint-damien | 61 | 10 | 59 | `AD-1` `AD-2` `AD-3` `AV-1` `AV-3` `AV-4` `AV-5` `CONS-1` +51 |
| sainte-genevieve-de-batiscan | 59 | 3 | 59 | `101-R` `102-P` `103-CR` `104-CR` `105-R` `106-R` `108-P` `109-CR` +51 |
| lyster | 61 | 4 | 58 | `A-10` `A-11` `A-13` `A-14` `A-15` `A-16` `A-17` `A-18` +50 |
| beaulac-garthby | 91 | 34 | 57 | `AD 1` `AD 2` `AD 3` `AD 4` `AFA 1` `AFA 2` `AFA 3` `AFA 4` +49 |
| charette | 57 | 81 | 57 | `101-AR` `102-AF` `103-RU` `104-REC` `105-AF` `106-F` `107-A` `108-AR` +49 |
| mulgrave-et-derry | 57 | 1 | 57 | `1-R` `10-E` `11-V` `12-C` `13-E` `14-E` `15-V` `16-C` +49 |
| saint-eugene-de-ladriere | 57 | 30 | 57 | `Ac-001` `Ac-004` `Ac-022` `Ac-024` `Ac-027` `Ad-008` `Ad-020` `Ad-021` +49 |
| saint-ulric | 57 | 24 | 57 | `1-R` `10-R` `11-C` `12-R` `13-C` `14-P` `15-R` `16-C` +49 |
| shefford | 64 | 134 | 57 | `10` `11` `13` `14` `15` `16` `17` `18` +49 |
| stanstead--memphremagog | 67 | 49 | 57 | `A-3` `A-5` `A-6` `A-7` `A-8` `AF-10` `AF-11` `AF-12` +49 |
| la-corne | 57 | 1 | 56 | `AG-1` `AG-2` `AG-3` `AG-4` `CO-1` `CO-2` `FO-1` `FO-10` +48 |
| la-sarre | 132 | 77 | 56 | `CV-1` `CV-2` `CV-3` `CV-4` `CV-5` `CV-6` `CV-7` `DD-1` +48 |
| sainte-anne-de-sabrevois | 56 | 6 | 56 | `A-01` `A-02` `A-03` `A-04` `A-05` `A-06` `A-07` `A-08` +48 |
| senneterre--la-vallee-de-lor | 124 | 77 | 56 | `AgFor-1` `Er-10` `Er-11` `Er-12` `Er-13` `Er-5` `Er-6` `Er-7` +48 |
| abercorn | 64 | 21 | 55 | `P-13` `P-14` `P-15` `P-16` `P-17` `P-180` `P-181` `P-181-1` +47 |
| bearn | 57 | 3 | 55 | `Aa1` `Aa2` `Aa3` `Aa4` `Aa5` `Aa6` `Aa7` `Ab1` +47 |
| disraeli--les-appalaches | 55 | 3 | 55 | `ADA 1` `ADA 2` `ADB 1` `AFAa 1` `AFAa 2` `AFAa 3` `AFAa 4` `AFAa 5` +47 |
| frampton | 56 | 1 | 55 | `AF-1` `AF-10` `AF-11` `AF-12` `AF-13` `AF-14` `AF-15` `AF-16` +47 |
| saint-narcisse | 55 | 3 | 55 | `101-C` `102-C` `103-I` `104-I` `105-CR` `106-CR` `107-R` `108-R` +47 |
| boischatel | 55 | 29 | 54 | `A1-121` `A1-128` `C2-062` `C2-064` `Cn1-074` `Cn1-075` `Cn1-105` `Cn1-115` +46 |
| daveluyville | 60 | 55 | 54 | `A1` `A11` `A13` `A14` `A16` `A3` `A4` `A5` +46 |
| saint-francois-xavier-de-brompton | 112 | 59 | 53 | `AF 1` `AF 10` `AF 11` `AF 2` `AF 3` `AF 4` `AF 5` `AF 6` +45 |
| saint-theophile | 55 | 16 | 53 | `A-10` `A-12` `AG-1` `AG-3` `AG-4` `AG-5` `AG-6` `AG-7` +45 |
| pierreville | 63 | 13 | 52 | `A-01` `A-02` `A-03` `A-04` `A-05` `A-06` `A-07` `A-08` +44 |
| pohenegamook | 122 | 70 | 52 | `EAA-1` `EAA-10` `EAA-11` `EAA-12` `EAA-13` `EAA-2` `EAA-3` `EAA-4` +44 |
| portneuf | 161 | 137 | 52 | `Af/a-1` `Af/a-101` `Af/a-102` `Af/a-103` `Af/a-104` `Af/a-105` `Af/a-106` `Af/a-107` +44 |
| val-joli | 52 | 2 | 52 | `A-1` `A-2` `A-3` `A-4` `A-5` `A-6` `A-7` `A-8` +44 |
| hatley-township-municipality | 52 | 1 | 51 | `A-1` `A-2` `A-5` `A-7` `EX-1` `EX-2` `EX-4` `ID-3` +43 |
| saint-adolphe-dhoward | 94 | 87 | 51 | `C-052` `C-067` `C-074` `C-080` `C-091` `C-093` `E-001` `E-020` +43 |
| saint-basile | 191 | 167 | 51 | `Af/a-1` `Af/a-2` `Af/a-4` `Af/a-5` `Af/b-1` `Af/b-2` `Af/b-3` `Af/b-4` +43 |
| saint-leon-de-standon | 54 | 3 | 51 | `A-120` `A-121` `A-122` `A-123` `A-124` `A-125` `AF-130` `AF-131` +43 |
| sainte-brigitte-de-laval | 87 | 73 | 51 | `HA-1` `HA-10` `HA-2` `HA-3` `HA-4` `HA-5` `HA-6` `HA-7` +43 |
| sainte-emelie-de-lenergie | 52 | 10 | 51 | `A-1` `A-2` `At1-1` `At1-2` `At1-3` `At1-4` `At1-5` `At2-1` +43 |
| sainte-henedine | 51 | 1 | 51 | `A-1` `A-10` `A-11` `A-12` `A-13` `A-14` `A-15` `A-16` +43 |
| victoriaville | 364 | 315 | 51 | `Rec801` `Rec803` `Rec804` `Rec805` `Rec806` `Rec808` `Rec810` `Rec816` +43 |
| wotton | 58 | 39 | 51 | `AF-1` `AF-2` `AF-3` `AF-4` `AR-1` `AR-2` `AR-3` `CONS-1` +43 |
| mont-carmel | 50 | 35 | 50 | `10ID` `11ID` `12ID` `13ID` `14AF` `15AF` `16ID` `17ID` +42 |
| montreal-ouest | 50 | 30 | 50 | `CL-4` `IB-1` `MA-1` `MA-4` `MB-1` `MB-2` `PA-1` `PA-12` +42 |
| neuville | 127 | 109 | 50 | `A/c-1` `Af/a-1` `Af/a-2` `Af/a-3` `Af/a-4` `Af/a-5` `Af/b-1` `Af/b-2` +42 |
| saint-pacome | 50 | 24 | 50 | `10ID` `11ID` `12AF` `13ID` `14ID` `15AF` `16ID` `17AF` +42 |
| saint-thomas-didyme | 50 | 45 | 50 | `A-21` `A-22` `A-23` `A-24` `A-25` `A-26` `A-26-1` `A-33-1` +42 |
| girardville | 105 | 56 | 49 | `A-100` `A-101` `A-64` `A-65` `A-66` `A-67` `A-68` `A-69` +41 |
| notre-dame-du-laus | 78 | 39 | 49 | `A-01` `A-02` `A-03` `CONS-01` `CONS-03` `CONS-04` `CONS-05` `CONS-06` +41 |
| sainte-croix | 49 | 19 | 49 | `01-H` `02-REC` `03-H` `04-CH` `05-H` `06-P` `07-P` `08-CH` +41 |
| lascension | 48 | 51 | 48 | `A-I` `A-II` `A-III` `A-IV` `CAM-I` `CAM-II` `CAM-III` `CAM-IV` +40 |
| saint-ours | 49 | 1 | 48 | `A-1` `A-10` `A-11` `A-12` `A-13` `A-14` `A-15` `A-16` +40 |
| sainte-beatrix | 48 | 32 | 48 | `A1-400` `A1-401` `A1-402` `A1-403` `A1-404` `A1-405` `A2-411` `A2-412` +40 |
| val-alain | 54 | 6 | 48 | `AD-1` `AD-2` `AD-3` `AD-4` `ADes-1` `ADes-2` `ADes-3` `ADes-4` +40 |
| coaticook | 203 | 156 | 47 | `A` `AD` `C` `C-202` `COMV` `COMV-818` `CONSV1` `CONSV2` +39 |
| orford | 126 | 80 | 47 | `A175` `A176` `A177` `A178` `CA150` `CA154` `PN201` `PN202` +39 |
| saint-francois-du-lac | 63 | 117 | 47 | `A-1` `A-10` `A-2` `A-3` `A-4` `A-5` `A-6` `A-7` +39 |
| saint-jude | 47 | 9 | 47 | `101` `102-P` `103` `104-P` `105-P` `106` `107` `108` +39 |
| saint-stanislas--des-chenaux | 47 | 3 | 47 | `101-I` `102-R` `103-CR` `104-CR` `105-R` `106-CR` `107-P` `108-P` +39 |
| ham-nord | 46 | 203 | 46 | `A1` `A10` `A2` `A3` `A4` `A5` `A6` `A7` +38 |
| notre-dame-du-rosaire | 46 | 2 | 46 | `Ac.1` `Ac.2` `Ac.4` `Ac.5` `Ac.6` `CbM.1` `CbM.2` `CbM.3` +38 |
| saint-anicet | 72 | 46 | 46 | `A-3` `A-4` `A-5` `A-6` `A-7` `A-8` `A-9` `AD-1` +38 |
| saint-edouard-de-fabre | 47 | 3 | 46 | `Aa1` `Aa10` `Aa12` `Aa2` `Aa3` `Aa4` `Aa5` `Aa6` +38 |
| sainte-clotilde | 76 | 30 | 46 | `Cb-3` `Ex1` `Ex2` `Ex3` `Ex4` `Ex5` `Ex6` `Id53` +38 |
| clarenceville | 45 | 1 | 45 | `106` `107` `108` `109` `110` `111` `112` `113` +37 |
| price | 45 | 22 | 45 | `1 (RCT)` `10 (HBF)` `11 (HBF)` `12 (ILD)` `13 (ILG)` `14 (AGC)` `15 (AGF)` `16 (HBF)` +37 |
| racine | 62 | 17 | 45 | `AFD-1` `AFD-2` `AFD-3` `AFD-4` `CR-1` `CR-7` `I-1` `IC-1` +37 |
| saint-marc-de-figuery | 47 | 3 | 45 | `AG-1` `AG-2` `AG-3` `CO-1` `EV-1` `EV-2` `FO-1` `FO-2` +37 |
| sainte-edwidge-de-clifton | 46 | 3 | 45 | `A` `A-1` `A-10` `A-11` `A-4` `A-5` `A-6` `A-7` +37 |
| pointe-a-la-croix | 69 | 25 | 44 | `C-2` `C-3` `FA-1` `FA-10` `FA-11` `FA-12` `FA-13` `FA-14` +36 |
| saint-elie-de-caxton | 44 | 70 | 44 | `201-RU` `202-F` `203-A` `204-RU` `205-RU` `206-A` `207-AF` `208-F` +36 |
| saint-gabriel-de-rimouski | 66 | 37 | 44 | `01 (FRT)` `02 (VLG)` `03 (AGF)` `04 (FRT)` `05 (AGF)` `06 (FRT)` `07 (AGF)` `08 (AIC)` +36 |
| saint-liguori | 46 | 46 | 44 | `AD-01` `AD-02` `AD-03` `AD-04` `AD-05` `AD-06` `AD-07` `AD-08` +36 |
| saint-ubalde | 122 | 90 | 44 | `Af/a-1` `Af/a-2` `Af/a-3` `Af/b-1` `Af/b-10` `Af/b-2` `Af/b-3` `Af/b-4` +36 |
| beaumont | 67 | 49 | 43 | `1-Ha` `11-Hb` `152-R` `154-R` `157-R` `16-M` `160-V` `161-V` +35 |
| ogden | 47 | 4 | 43 | `10R` `11R` `12Rv` `13Rv` `14Rv` `15Rv` `16Ex` `17Ex` +35 |
| saint-alexandre-de-kamouraska | 43 | 24 | 43 | `10AF` `11AF` `12ID` `13ID` `14ID` `15A` `16AF` `17AF` +35 |
| saint-lucien | 48 | 5 | 43 | `A-1` `A-2` `AV-1` `AV-10` `AV-11` `AV-12` `AV-13` `AV-14` +35 |
| saint-irenee | 42 | 3 | 42 | `A-1` `A-16` `A-2` `A-22` `A-23` `A-25` `A-27` `A-28` +34 |
| sainte-praxede | 42 | 25 | 42 | `AD 1` `AD 2` `AD 3` `AFa 1` `AFa 2` `AFa 3` `AFa 4` `AFa 5` +34 |
| hatley | 42 | 11 | 41 | `A-1` `A-10` `A-11` `A-12` `A-13` `A-15` `A-16` `A-17` +33 |
| saint-alexandre | 42 | 1 | 41 | `A-1` `A-2` `A-3` `A-4` `A-5` `A-6` `A-7` `A-8` +33 |
| saint-louis-de-blandford | 56 | 41 | 41 | `A13` `A14` `A16` `AF1` `AF2` `AF3` `AF4` `AF5` +33 |
| sainte-brigide-diberville | 42 | 6 | 41 | `A-1` `A-10` `A-2` `A-3` `A-4` `A-5` `A-6` `A-7` +33 |
| val-des-lacs | 41 | 1 | 41 | `AF-1` `AF-2` `C-1` `C-2` `CD-2` `CT-1` `CT-2` `CT-3` +33 |
| blue-sea | 40 | 12 | 40 | `AGD-01` `AGD-02` `AGV-01` `F-01` `F-02` `F-03` `F-04` `PU-01` +32 |
| dupuy | 41 | 20 | 40 | `AD1` `AD2` `AD3` `AD4` `AD5` `AD6` `AL1` `AL2` +32 |
| hudson | 43 | 7 | 39 | `A-2` `A-46` `A-50` `A-6` `C-8` `CONS-23` `CONS-64` `P-32` +31 |
| nedelec | 44 | 24 | 39 | `Aa2` `Ab1` `Ab2` `Ab3` `Ab4` `Ab5` `Ab6` `Ab7` +31 |
| pointe-claire | 122 | 183 | 39 | `G1` `G2` `Pa14` `Pa18` `Pa2` `Pa25` `Pa26` `Pa28` +31 |
| saint-hubert-de-riviere-du-loup | 39 | 14 | 39 | `10-AF` `11-A` `28-REC` `30-CH` `30-P` `32-H` `32-P` `33-A` +31 |
| saint-just-de-bretenieres | 39 | 12 | 39 | `Ac.1` `CbM.1` `CbM.2` `CbM.3` `CcM.1` `Fa.2` `Fc.1` `Fc.10` +31 |
| amos | 39 | 41 | 38 | `A-5` `AF-12` `AF-13` `C-6` `C1` `ID-8` `P-10` `P-12` +30 |
| grenville-sur-la-rouge | 77 | 40 | 38 | `A-03` `A-05` `A-06` `AF-04` `AF-05` `AF-06` `AF.T-03` `AF.T-04` +30 |
| mille-isles | 66 | 66 | 38 | `H-10` `H-13` `H-14` `H-15` `H-16` `H-17` `H-18` `H-19` +30 |
| morin-heights | 68 | 30 | 38 | `RF-11` `RV-1` `RV-10` `RV-11` `RV-12` `RV-13` `RV-14` `RV-15` +30 |
| saint-claude | 64 | 26 | 38 | `AG-1` `AG-2` `AG-3` `AG-4` `AG-5` `CL-1` `ID-1` `ID-10` +30 |
| saint-eugene | 42 | 23 | 38 | `A1` `A10` `A11` `A12` `A2` `A3` `A6` `A7` +30 |
| sainte-eulalie | 38 | 8 | 38 | `A1` `A2` `A3` `A4` `A5` `A6` `A7` `C-14` +30 |
| carleton-sur-mer | 161 | 126 | 37 | `001-F` `002-F` `003-F` `004-F` `005-F` `006-F` `007-A` `008-V` +29 |
| notre-dame-des-neiges | 37 | 1 | 37 | `A-1` `A-10` `A-11` `A-12` `A-13` `A-14` `A-15` `A-16` +29 |
| saint-adelphe | 37 | 4 | 37 | `1-Aa` `10-Aa` `11-Aa` `12-Af` `14-Af` `16-Af` `17-Af` `18-Af` +29 |
| saint-rosaire | 44 | 10 | 37 | `A1` `A10` `A11` `A12` `A13` `A14` `A15` `A16` +29 |
| schefferville | 53 | 21 | 37 | `CV.1` `CV.2` `CV.3` `CV.4` `CV.5` `Ca.1` `Ca.2` `Ca.3` +29 |
| deschambault-grondines | 177 | 169 | 36 | `A-217` `Af/a-301` `Af/a-302` `Af/a-303` `Af/a-304` `Af/a-305` `Af/a-306` `Af/b-201` +28 |
| ham-sud | 36 | 9 | 36 | `A1` `A12` `A13` `A15` `A2` `Af17` `Af18` `F10` +28 |
| kamouraska | 36 | 21 | 36 | `AA1` `AA2` `AA3` `AA4` `AA5` `AB1` `AB2` `AB3` +28 |
| notre-dame-de-lourdes--joliette | 43 | 40 | 36 | `A-1` `A-10` `A-11` `A-12` `A-13` `A-14` `A-15` `A-2` +28 |
| packington | 36 | 6 | 36 | `EAA-1` `EAA-2` `EAB-1` `EAB-2` `EAB-3` `EAB-4` `EAB-5` `EAB-7` +28 |
| saint-donat--matawinie | 36 | 1 | 36 | `CS-8` `I-1` `I-2` `RT-1` `RT-11` `RT-15` `RT-16` `RT-17` +28 |
| saint-marc-du-lac-long | 49 | 13 | 36 | `EAB-1` `EAB-2` `EAB-3` `EAF-1` `EAF-2` `EAF-3` `EAF-4` `EAF-5` +28 |
| saint-narcisse-de-beaurivage | 39 | 3 | 36 | `1-H` `10-CH` `11.1-I` `13.3-I` `14-H` `15-A` `16-A` `17.2-A` +28 |
| val-morin | 75 | 43 | 36 | `A1-1` `C1-1` `C1-2` `C1-3` `C1-4` `C2-4` `C2-5` `C2-6` +28 |
| ange-gardien | 39 | 5 | 35 | `106` `107-P` `108` `109` `110` `111` `112` `113` +27 |
| brigham | 40 | 7 | 35 | `A-42` `AF-41` `C1-31` `E-08-B` `FM-38` `I2-37` `I3-40` `ID-01` +27 |
| crabtree | 64 | 72 | 35 | `A-24` `A-25` `A-26` `A-27` `AG-1` `AI-1` `Ca-1` `Cb-1` +27 |
| franquelin | 36 | 18 | 35 | `A-22` `C-08` `C-16` `CO-05` `CO-19` `CO-21` `CO-26` `CO-29` +27 |
| inverness | 35 | 8 | 35 | `A-1` `A-10` `A-11` `A-13` `A-14` `A-15` `A-16` `A-17` +27 |
| mandeville | 37 | 3 | 35 | `A-1` `A-2` `A-3` `A-4` `A-5` `AD-1` `C-1` `C-2` +27 |
| riviere-au-tonnerre | 37 | 15 | 35 | `CR-1` `CR-2` `CR-3` `CR-4` `CR-5` `CT-1` `Ca-1` `Fa-1` +28 |
| saint-denis-de-brompton | 83 | 49 | 35 | `AFEX-1` `AFR-3` `AFR-5` `AQ-1` `AQ-2` `AQ-3` `AQ-4` `AQ-5` +27 |
| saint-gilles | 54 | 25 | 35 | `A-1` `AD-1` `AD-10` `AD-11` `AD-12` `AD-13` `AD-14` `AD-2` +27 |
| barraute | 78 | 52 | 34 | `AF-1` `AF-2` `AF-3` `AF-4` `AF-5` `AG-1` `AG-2` `MX-5` +26 |
| dosquet | 34 | 4 | 34 | `10H` `11H/C` `12H/C` `13H/C` `14H/C` `15H/C` `16I/C` `17I/C` +26 |
| petit-saguenay | 35 | 3 | 34 | `60-P` `A100` `A102` `A4` `A41` `A42` `A45` `A46` +26 |
| saint-alban | 100 | 91 | 34 | `Af/a-1` `Af/a-2` `Af/a-3` `Af/a-4` `Af/b-1` `Af/b-2` `Af/b-3` `Af/b-4` +26 |
| saint-cuthbert | 34 | 27 | 34 | `10H` `10H1` `11F` `12VHC` `13VR` `14VH` `15VHC` `16VHC` +26 |
| saint-georges-de-windsor | 41 | 43 | 34 | `Aa10` `Aa21` `Aa36` `Aa37` `Aa38` `Aa7` `Aa9` `Ab1` +26 |
| saint-raphael | 97 | 64 | 34 | `A-104` `A-105` `A-108` `A-109` `A-110` `A-111` `AF-115` `AF-116` +26 |
| sainte-petronille | 39 | 5 | 34 | `A-801` `A-802` `A-803` `A-804` `A-805` `A-806` `PA-801` `PA-802` +26 |
| labrecque | 37 | 4 | 33 | `Ab2` `Ac1` `Ac2` `Ac3` `Ac4` `Ac5` `Ac6` `Fb1` +25 |
| lac-des-aigles | 33 | 2 | 33 | `51-C` `51-P` `52-P` `53-B` `54-B` `55-P` `56-P` `EAA-1` +25 |
| riviere-beaudette | 33 | 41 | 33 | `Ag-107` `Ag-112` `Ag-115` `Ag-116` `Age-103` `Age-104` `Age-113` `Cm-108` +25 |
| saint-narcisse-de-rimouski | 69 | 58 | 33 | `Ac-040` `Ac-041` `Ad-012` `Ad-014` `Ad-019` `Ad-023` `Ad-025` `Ad-039` +25 |
| sainte-marcelline-de-kildare | 43 | 31 | 33 | `Ag-1` `Ag-2` `Ag-3` `Cr-1` `In-1` `In-2` `Mb-1` `Pa-1` +25 |
| la-conception | 42 | 54 | 32 | `AF-05` `AG-01` `AG-02` `AG-03` `AG-04` `CF-02` `FC-06` `FC-07` +24 |
| lac-superieur | 32 | 1 | 32 | `CM-02` `NA-01` `NA-07` `NA-08` `NA-10` `NA-12` `NA-13` `NA-14` +24 |
| nominingue | 106 | 75 | 32 | `Rc-1` `Ru-2` `Va-10` `Va-11` `Va-12` `Va-13` `Va-14` `Va-15` +24 |
| remigny | 34 | 13 | 32 | `A1` `A2` `A3` `A4` `A5` `Bc1` `E1` `F1` +24 |
| saint-luc-de-vincennes | 32 | 3 | 32 | `101-R` `102-R` `103-I` `104-CR` `105-R` `106-CR` `107-P` `108-R` +24 |
| sainte-christine-dauvergne | 72 | 165 | 32 | `A-9` `Af/a-1` `Af/a-2` `Af/a-3` `Af/b-1` `Af/b-2` `Af/b-3` `Af/b-4` +24 |
| tres-saint-sacrement | 33 | 22 | 32 | `A-1` `A-10` `A-11` `A-12` `A-13` `A-14` `A-15` `A-2` +24 |
| east-farnham | 36 | 7 | 31 | `A-07` `A-20` `AF-01` `AF-02` `AF-05` `C1-08` `C1-11` `C2-25` +23 |
| escuminac | 42 | 11 | 31 | `AA-1` `AA-2` `AA-3` `AA-4` `AA-5` `AC-1` `AC-2` `AC-3` +23 |
| lassomption | 359 | 338 | 31 | `C1-11` `C1-12` `C1-16` `C1-18` `H1-105` `H1-12` `H1-127` `H1-133` +23 |
| manseau | 32 | 21 | 31 | `A-01` `A-02` `A-03` `AGF-01` `AGF-02` `AGF-03` `AGF-04` `AGF-05` +23 |
| normetal | 37 | 21 | 31 | `A1` `A2` `C` `CV1` `CV2` `CV3` `EV` `EX1` +23 |
| pontiac | 48 | 36 | 31 | `AD-09` `AD-12` `AD-14` `AD-16` `AD-17` `AD-19` `AD-20` `AD-21` +23 |
| saint-majorique-de-grantham | 36 | 26 | 31 | `A1` `A2` `A3` `A4` `A5` `A6` `A7` `C1` +23 |
| sainte-cecile-de-milton | 32 | 1 | 31 | `A-2` `A-3` `A-4` `A-5` `A-6` `A-7` `AF-1` `AF-2` +23 |
| val-des-monts | 31 | 4 | 31 | `14AV` `15F` `16RU` `17RU` `18RU` `19RR` `21AD` `22RU` +23 |
| auclair | 33 | 35 | 30 | `EAA-1` `EAA-2` `EAA-3` `EAA-4` `EAA-5` `EAB-1` `EAB-2` `EAB-3` +22 |
| cap-sante | 144 | 145 | 30 | `Af/b-1` `Af/c-1` `Af/c-2` `Af/c-3` `Af/c-4` `C-12` `Cons-1` `I-1` +22 |
| duhamel-ouest | 31 | 16 | 30 | `Aa/Cb1` `Aa/Cb2` `Aa/Cb4` `Aa/R1` `Aa/R2` `Aa/R3` `Aa/R4` `AaCa1` +22 |
| saint-eusebe | 32 | 29 | 30 | `EAA-1` `EAA-2` `EAA-3` `EAA-4` `EAA-5` `EAA-6` `EAA-7` `EAA-8` +22 |
| saint-gabriel-lalemant | 37 | 30 | 30 | `10ID` `11ID` `12ID` `13ID` `14ID` `15ID` `18F` `1ID` +22 |
| belleterre | 29 | 14 | 29 | `Cb1` `Cb2` `Cc1` `Cc2` `Ev1` `Fa1` `Fa2` `Fa3` +21 |
| boileau | 32 | 4 | 29 | `AD-01` `CIM-01` `CIM-02` `CIM-03` `CIM-04` `ECO-01` `ECO-02` `FOR-01` +21 |
| bonaventure | 89 | 96 | 29 | `1-R` `10-R` `11-I` `112-R` `113-P` `12-M` `14-R` `15-I` +21 |
| entrelacs | 34 | 6 | 29 | `C-1` `C-2` `CONS-1` `CONS-2` `CONS-3` `CONS-4` `FR-1` `H-1` +21 |
| la-macaza | 46 | 22 | 29 | `CAM-04` `CAM-10` `FO-01` `FO-02` `FO-03` `FO-04` `FO-05` `FO-06` +21 |
| la-minerve | 29 | 19 | 29 | `AF-01` `AF-02` `AF-03` `AF-04` `AF-05` `AF-06` `AF-07` `AF-09` +21 |
| notre-dame-des-monts | 34 | 9 | 29 | `A12` `A15` `AA20` `AA22` `AA25` `AF-23` `AF14` `AF16` +21 |
| saint-felix-de-dalquier | 33 | 5 | 29 | `AF-1` `AF-2` `AF-3` `AF-4` `AG-1` `AG-2` `AG-3` `AG-4` +21 |
| sainte-victoire-de-sorel | 29 | 6 | 29 | `A-1` `A-10` `A-11` `A-2` `A-3` `A-4` `A-5` `A-6` +21 |
| baie-du-febvre | 32 | 5 | 28 | `A-1` `A-10` `A-2` `A-3` `A-4` `A-5` `A-6` `A-7` +20 |
| la-motte | 46 | 29 | 28 | `AF-1` `AF-2` `AG-1` `AG-2` `CS-1` `MX-1` `MX-2` `MX-3` +20 |
| lascension-de-patapedia | 28 | 26 | 28 | `AA-1` `AA-2` `AB-1` `AB-2` `AB-3` `AC-1` `AC-2` `AC-3` +20 |
| saint-roch-des-aulnaies | 28 | 2 | 28 | `10E` `1Rv` `2Rv` `32Ad1` `33Ad1` `34Ad1` `35Ad1` `36Ad1` +20 |
| sept-iles | 667 | 640 | 28 | `1 I` `1005-5R` `1008-1R` `1009-1R` `101 REC` `1010-1R` `1012-1R` `1013-1R` +20 |
| beaupre | 78 | 51 | 27 | `1-Co` `14-Co` `16-Co` `21-H` `25-P` `27-H` `29-H` `40-P` +19 |
| notre-dame-du-portage | 27 | 10 | 27 | `11-H` `12-H` `17-H` `20-Z` `21-H` `22-H` `23-P` `25-H` +19 |
| saint-juste-du-lac | 30 | 50 | 27 | `EAA-1` `EAA-2` `EAA-3` `EAA-4` `EAB-1` `EAB-2` `EAB-3` `EAF-1` +19 |
| saint-prosper-de-champlain | 27 | 25 | 27 | `101-CR` `102-R` `103-P` `104-P` `105-CR` `106-P` `107-CR` `108-R` +19 |
| saint-raymond | 350 | 343 | 27 | `AID-17` `AVc-1` `AVc-2` `AVc-3` `C-25` `C-26` `C-27` `EX-1` +19 |
| saint-valerien | 54 | 43 | 27 | `Ac-014` `Ac-024` `Ac-025` `Ac-027` `Ac-031` `Ac-033` `Ad-012` `Ad-013` +19 |
| sainte-claire | 49 | 133 | 27 | `1-Hc` `10-Ha` `100-A` `101-A` `102-A` `104-A` `105-A` `106-AI` +19 |
| scotstown | 33 | 14 | 27 | `Ind-1` `Ind-2` `Ind-3` `Ins-1` `Ins-2` `Ins-3` `M-1` `M-2` +19 |
| chateau-richer | 96 | 70 | 26 | `AGF-392` `C-216` `C-228` `CO-001` `CO-002` `F-148` `F-164` `F-168` +18 |
| lejeune | 26 | 2 | 26 | `EAA-1` `EAA-2` `EAA-3` `EAA-4` `EAB-1` `EAB-2` `EAB-3` `EAB-4` +18 |
| lingwick | 26 | 7 | 26 | `AG-1` `AG-2` `AG-3` `AG-4` `AG-5` `AG-6` `AG-7` `F-1` +18 |
| petite-riviere-saint-francois | 127 | 101 | 26 | `E-1` `F-10` `F-13` `F-17` `FL-1` `H-1` `H-19` `H-21` +18 |
| saint-adrien | 56 | 30 | 26 | `A-33` `A-35` `AFB-38` `AFV-31` `AFV-32` `AFV-34` `AFV-36` `C-105` +18 |
| saint-etienne-de-bolton | 33 | 14 | 26 | `AGF1-1` `AGF2-1` `AGF2-2` `AGF2-3` `AGF2-4` `AGF2-5` `AGF2-6` `ID-1` +18 |
| saint-louis-du-ha-ha | 64 | 38 | 26 | `EAA-1` `EAA-2` `EAA-3` `EAA-4` `EAA-5` `EAA-6` `EAA-7` `EAA-8` +18 |
| saint-maxime-du-mont-louis | 28 | 32 | 26 | `Eaf.3` `Eaf.4` `Eaf.40` `Eaf.41` `Eaf.42` `Eaf.5` `Eaf.6` `Eaf.70` +18 |
| thurso | 26 | 7 | 26 | `C-a 142` `C-c 129` `COM-a 115` `COM-a 118` `COM-a 127` `COM-a 147` `COM-a 148` `CONS-a 134` +18 |
| wentworth | 27 | 14 | 26 | `CONS-1` `NV-26` `RU-10` `RU-11` `RU-12` `RU-13` `RU-14` `RU-15` +18 |
| deux-montagnes | 123 | 100 | 25 | `A-104` `DM-128` `P-117` `P-124` `P-141` `P-181` `P-189` `P-212` +17 |
| godmanchester | 35 | 10 | 25 | `A-1-4` `A-2-2-1` `A-2-3-1` `A-2-3-2` `A-2-3-3` `CU-1` `Hameau Dewittville` `Hameau Kensington` +17 |
| lac-frontiere | 25 | 19 | 25 | `CbM.1` `Fa.2` `Fa.3` `Fa.4` `Fb.1` `Fb.2` `Fc.3` `Fc.5` +17 |
| lancienne-lorette | 41 | 118 | 25 | `B4` `C-A7` `C-C3` `C-C4` `C-C5` `C-C6` `P-A1` `P-A2` +17 |
| nantes | 82 | 59 | 25 | `AFT1-1` `AFT1-10` `AFT1-11` `AFT1-12` `AFT1-13` `AFT1-2` `AFT1-3` `AFT1-9` +17 |
| saint-calixte | 34 | 50 | 25 | `AD-1` `AD-2` `F1-1` `F1-12` `F1-13` `F1-14` `F1-15` `F1-16` +17 |
| saint-edmond-de-grantham | 25 | 187 | 25 | `A-1` `A-2` `A-3` `A-4` `AF-1` `AF-2` `AFp-1` `AFp-2` +17 |
| saint-remi-de-tingwick | 26 | 32 | 25 | `A1` `A10` `A11` `A2` `A3` `A4` `A5` `A6` +17 |
| sainte-germaine-boule | 40 | 59 | 25 | `AG-1` `AG-2` `AGF-1` `AGF-2` `CV-1` `CV-2` `CV-3` `Ca-1` +17 |
| clermont--charlevoix-est | 108 | 84 | 24 | `012.1-Af` `018-Af` `019-Af` `020-Rec` `023-Af` `028-Ad` `106-Ha` `106.1-Ha` +16 |
| fugereville | 29 | 14 | 24 | `A1` `BG1` `E1` `E2` `E3` `E4` `E5` `E6` +16 |
| gaspe | 262 | 238 | 24 | `A-171-1` `AF-149-1` `AF-163-1` `C-270-1` `CI-299-1` `CI-299-2` `CO-301-1` `CO-410-1` +16 |
| huberdeau | 24 | 28 | 24 | `1-AF` `10-F` `11-R` `12-R` `13-I` `14-R` `15-R` `16-MV` +16 |
| les-coteaux | 68 | 130 | 24 | `C-222` `I-135` `M-112` `M-201` `M-235` `RB-107` `RB-109` `RB-115` +16 |
| saint-julien | 33 | 20 | 24 | `AD 2` `AD 3` `AD 4` `AFAa 10` `AFAa 2` `AFAa 3` `AFAa 4` `AFAa 5` +16 |
| saint-zotique | 34 | 86 | 24 | `1A` `224P` `230Cn` `232Hb` `233Ha` `235Ha` `236R` `246C` +16 |
| salaberry-de-valleyfield | 640 | 681 | 24 | `A-907` `C-227-1` `C-240` `C-403-1` `C-652 PAE` `C-714` `C-728` `C-801` +16 |
| baie-sainte-catherine | 24 | 1 | 23 | `A101` `AF102` `AF111` `AF112` `AF113` `AF114` `AF115` `AF120` +15 |
| barkmere | 23 | 9 | 23 | `Cons-01` `Cons-03` `Cons-04` `Cons-05` `Cons-06` `Nv-01` `Nv-02` `Nv-03` +15 |
| bristol | 23 | 3 | 23 | `AG-110` `AG-111` `AG-115` `AG-116` `AG-117` `AG-121` `AG-122` `AG-123` +15 |
| forestville | 39 | 112 | 23 | `10-A` `10-B` `11-B` `13-B` `17-A` `17-B` `20-A` `20-B` +15 |
| havre-saint-pierre | 23 | 31 | 23 | `102 Cn` `104 Cn` `105 Cn` `73 V` `78 Res` `79 Res` `80 Res` `81 Res` +15 |
| lac-des-seize-iles | 23 | 5 | 23 | `RC-1` `RC-2` `RC-3` `RC-4` `RV-1` `RV-10` `RV-11` `RV-12` +15 |
| lachute | 225 | 206 | 23 | `Cb-205-1` `Ha-529` `Ha-530` `Ha-531` `Ha-532` `Hb-412-1` `Hb-533` `Hc-101-3` +15 |
| nouvelle | 100 | 78 | 23 | `10-Ha` `102-Cn` `106-Ha` `112-Ha` `116-Ha` `12-Cn` `120-P` `122-M` +15 |
| saint-antoine-de-lisle-aux-grues | 23 | 6 | 23 | `AaM.1` `AaMP.2` `Ab.1` `Ab.2` `Ac.1` `CbMP.1` `CbMP.2` `RbMP.1` +15 |
| saint-clet | 36 | 64 | 23 | `MXT-1` `MXT-2` `MXT-3` `MXT-4` `MXT-5` `MXTV-1` `MXTV-2` `MXTV-3` +15 |
| sainte-francoise--les-basques | 26 | 15 | 23 | `A-3` `A-4` `A-5` `A-6` `A-7` `A-8` `F-1` `F-2` +15 |
| authier | 27 | 6 | 22 | `AV-1` `AV-2` `FO-1` `FO-2` `FO-3` `FO-4` `FO-5` `MX-1` +14 |
| brebeuf | 65 | 80 | 22 | `Af-33` `Af-38` `Af-43` `Af-45` `Af-46` `Ag-2` `Ag-47` `Br-08` +14 |
| elgin | 26 | 4 | 22 | `A-2` `A-3` `A-4` `A-5` `A-5-1` `A-6` `A-7` `AG-1` +14 |
| lac-drolet | 70 | 59 | 22 | `A-11` `A-8` `A-9` `AFT1-10` `AFT1-11` `AFT1-13` `AFT1-9` `CONS-5` +14 |
| les-eboulements | 93 | 71 | 22 | `Ad-P1` `Ad-P2` `C-01` `C-02a` `C-02b` `C-03` `F-03` `F-04` +14 |
| matapedia | 43 | 35 | 22 | `C-1` `C-2` `C-3` `C-4` `C-5` `CO-1` `CO-2` `FA-7` +14 |
| saint-patrice-de-sherrington | 33 | 37 | 22 | `A-1` `A-2` `A-3` `A-4` `A-5` `A-6` `Af-1` `Af-2` +14 |
| saint-valerien-de-milton | 22 | 1 | 22 | `A-101` `A-102` `A-103` `A-104` `A-201` `A-202` `A-301` `A-302` +14 |
| sainte-sabine--les-etchemins | 22 | 4 | 22 | `02-H` `03-CH` `04-CH` `05-CH` `06-CH` `07-CH` `08-P` `09-F` +14 |
| maskinonge | 28 | 36 | 21 | `208-A` `209-A` `210-A` `211-A` `212-A` `213-A` `214-RC` `215-A` +13 |
| notre-dame-de-la-paix | 21 | 23 | 21 | `1-R` `11-F` `12-F` `13-F` `14-M` `15-M` `16-M` `17-i` +13 |
| notre-dame-des-bois | 47 | 47 | 21 | `AFT1-1` `AFT1-10` `AFT1-11` `AFT1-13` `AFT1-14` `AFT1-2` `AFT1-3` `AFT1-4` +13 |
| saint-edouard-de-lotbiniere | 34 | 41 | 21 | `AGF-1` `AID-1` `AID-2` `AID-3` `AID-4` `AID-5` `AV-1` `C-2` +13 |
| saint-philemon | 78 | 69 | 21 | `1-HD` `1-HJ` `1-HV` `1-Ha` `13-HV` `14-HV` `15-HV` `16-M` +13 |
| sainte-marie-salome | 28 | 7 | 21 | `A1-1` `A1-3` `A1-6` `A1-8` `A2-2` `A2-9` `AC-10` `AC-31` +13 |
| lavaltrie | 169 | 184 | 20 | `A-124` `C-109` `C-111` `C-135` `C-137` `C-140` `C-156` `C-169` +12 |
| saint-boniface | 21 | 5 | 20 | `106` `107` `109` `110` `111` `112` `113` `114` +12 |
| saint-charles-sur-richelieu | 62 | 42 | 20 | `A-1` `A-2` `P-2` `P-3` `P-4` `P-5` `P-6` `P-7` +13 |
| saint-damien-de-buckland | 75 | 55 | 20 | `1-Ha` `10-Hc` `11-Ha` `12-Ha` `13-Ha` `14-M` `149-F` `16-M` +12 |
| saint-sebastien--le-granit | 41 | 40 | 20 | `AFT1-1` `AFT1-2` `AFT1-3` `AFT1-4` `AFT1-5` `AFT1-6` `AFT1-7` `AFT1-8` +12 |
| sainte-monique--lac-saint-jean-est | 21 | 2 | 20 | `11-F` `12-V` `13-A` `14-A` `15-V` `16-F` `17-V` `18-A` +12 |
| arundel | 37 | 25 | 19 | `Af-1` `Af-11` `Af-13` `Af-38` `Af-39-1` `Af-41` `Af-42` `Ag-2` +11 |
| milan | 48 | 47 | 19 | `AFT1-1` `AFT1-10` `AFT1-11` `AFT1-12` `AFT1-13` `AFT1-14` `AFT1-15` `AFT1-16` +11 |
| riviere-a-pierre | 135 | 140 | 19 | `Ie-1` `Ie-2` `Ie-3` `Rc-1` `Rec-9` `Rec/f-1` `Rec/f-10` `Rec/f-11` +11 |
| ferme-neuve | 112 | 96 | 18 | `COM-04` `FF-01` `FF-02` `FF-03` `FF-04` `FF-05` `FF-06` `FF-07` +10 |
| lac-saint-paul | 34 | 16 | 18 | `A-04` `CONS-01` `FO-01` `FO-02` `IND-01` `REC-03` `REC-07` `REC-08` +10 |
| saint-andre-de-kamouraska | 19 | 47 | 18 | `10A` `11ID` `12R` `13R` `14P` `15R` `16P` `17M` +10 |
| sainte-catherine-de-hatley | 83 | 85 | 18 | `Id-6` `Id-7` `Id-8` `Id-9` `Idr-1` `Idr-2` `Idr-3` `Idr-4` +10 |
| ayers-cliff | 43 | 26 | 17 | `Af2-1` `Af2-2` `Ere-1` `Ere-2` `Rec-6` `Res-12` `Res-13` `Res-15` +9 |
| baie-comeau | 237 | 257 | 17 | `161 CV` `17 P` `180 CO` `2 F` `274 CO` `3 V` `30 M` `326 C` +9 |
| guerin | 17 | 17 | 17 | `Aa1` `Ab1` `Ac1` `C1` `F1` `F2` `F3` `Ind1` +9 |
| kirkland | 81 | 138 | 17 | `10 P` `11 P` `13 P` `14 P` `15 P` `16 P` `17 P` `18 P` +9 |
| saint-lazare-de-bellechasse | 33 | 82 | 17 | `1-Ha` `101-A` `102-A` `122-Af` `123-Af` `124-Af` `130-R` `140-Ha` +9 |
| saint-victor | 66 | 49 | 17 | `I-70` `I-71` `I-72` `I-73` `M-60` `M-61` `M-62` `R-42` +9 |
| bonsecours | 53 | 37 | 16 | `DMS-1` `ID-01` `ID-02` `ID-04` `ID-05` `ID-06` `ID-07` `IND-1` +8 |
| chertsey | 19 | 26 | 16 | `RF-5` `RU-12` `RU-8` `RU-9` `URB-11` `URB-2` `URB-21` `URB-5` +8 |
| duhamel | 16 | 49 | 16 | `016-V` `32-A` `35-B` `40-P` `41-B` `43-A` `43-B` `43-P` +8 |
| saint-polycarpe | 16 | 107 | 16 | `A1-1` `A1-10` `A1-11` `A1-12` `A1-13` `A1-14` `A1-2` `A1-3` +8 |
| sainte-anne-du-lac | 53 | 37 | 16 | `A-13` `A-14` `CAM-04` `CONS-01` `CONS-02` `CONS-03` `FOR-02` `IND-01` +8 |
| chesterville | 48 | 51 | 15 | `A10` `C1` `C2` `C3` `C4` `C5` `C6` `C7` +7 |
| danville | 130 | 119 | 15 | `A-22` `AF-6` `AF-7` `E-1` `E-2` `E-3` `ID-6` `M-11` +7 |
| denholm | 15 | 7 | 15 | `b2` `c6` `c9` `f1` `f3` `h1` `h12` `i4` +7 |
| montcalm | 15 | 6 | 15 | `1-V` `10-A` `11-A` `12-V` `13-M` `14-V` `15-V` `16-V` +7 |
| notre-dame-du-sacre-coeur-dissoudun | 22 | 7 | 15 | `AA1` `AA2` `AA3` `AA4` `AA5` `AB1` `AD1` `AD2` +7 |
| saint-fabien | 70 | 56 | 15 | `Af-26` `Cm-108` `Cm-109` `Cm-110` `Cm-111` `Cm-112` `Cm-113` `Com-145` +7 |
| saint-ignace-de-stanbridge | 20 | 17 | 15 | `A-01` `A-02` `A-03` `A-26` `A-28` `A-30` `ARe-33` `C5-04` +7 |
| saint-justin | 50 | 81 | 15 | `SJU-01` `SJU-02` `SJU-03` `SJU-04` `SJU-06` `SJU-07` `SJU-08` `SJU-09` +7 |
| saint-magloire | 35 | 20 | 15 | `21-A` `22-F` `23-AF` `24-A` `25-F` `26-A` `27-F` `28-F` +7 |
| valcourt--le-val-saint-francois--2 | 20 | 66 | 15 | `A-1` `A-4` `A-5` `CV-4` `I-2` `P-8` `R-10` `R-11` +7 |
| lawrenceville | 44 | 32 | 14 | `AFD-1` `AFD-2` `AFD-3` `AFD-4` `AFD-5` `AFD-6` `IND-1` `IND-3` +6 |
| les-escoumins | 15 | 31 | 14 | `129Rfa` `16V` `18V` `21Co` `22Af` `23Av` `24Av` `25Af` +6 |
| mayo | 14 | 192 | 14 | `1-Af` `10-Ad` `11-Ade` `12-F` `13-Ae` `14-V` `2-Ade` `3-Ade` +6 |
| riviere-bleue | 62 | 48 | 14 | `EAA-1` `EAA-2` `EAA-3` `EAA-4` `EAA-5` `EAA-6` `EAA-7` `EAA-8` +6 |
| saint-aime-du-lac-des-iles | 46 | 34 | 14 | `A-Î01` `A-Î02` `COM-01` `CONS-01` `CONS-02` `CONS-03` `FO-01` `FO-02` +6 |
| saint-benoit-labre | 14 | 1 | 14 | `A-20` `A-21` `A-22` `A-23` `AG-1` `AG-10` `AG-2` `AG-3` +6 |
| saint-bruno-de-kamouraska | 17 | 22 | 14 | `10R` `11M` `13P` `14P` `15RZ` `16R` `1AF` `2ID` +6 |
| sainte-cecile-de-whitton | 91 | 96 | 14 | `AFT1-23` `AFT1-25` `IL-41` `IL-42` `IL-43` `IL-44` `IL-45` `IL-46` +6 |
| westbury | 47 | 35 | 14 | `047-P` `102-P` `184-P` `207-P` `211-P` `219-P` `248-P` `431-P` +6 |
| grandes-piles | 13 | 20 | 13 | `30-Va` `31-Vb` `32-Va` `34-Va` `35-Ra` `43-Ib` `45-Ca` `52-Va` +5 |
| preissac | 25 | 36 | 13 | `AF-1` `AF-3` `AF-4` `AG-1` `AG-2` `IA-1` `VC-13` `VC-2` +5 |
| saint-donat--la-mitis | 55 | 60 | 13 | `01 (AGF)` `01 (FRT)` `01 AGF)` `02 (AGC)` `02 (AGF)` `02 (VLG)` `03 (AGF)` `04 (AIC)` +8 |
| saint-pascal | 58 | 59 | 13 | `10A` `15ID` `18R` `1A` `25M` `2ID` `30M` `34M` +5 |
| sainte-seraphine | 13 | 139 | 13 | `A1` `A2` `A3` `C1` `C2` `H1` `I1` `P1` +5 |
| stornoway | 63 | 67 | 13 | `AFT1-11` `I-1` `I-2` `I-3` `IL-80` `IL-81` `IL-82` `IL-83` +5 |
| tres-saint-redempteur | 13 | 91 | 13 | `A-17` `A-2` `A-3` `A-6` `Cons-13` `RA-4` `RA-8` `RA-9` +5 |
| bolton-ouest | 29 | 21 | 12 | `AF-1` `AF-3` `AF-4` `DESI-02` `DESI-03` `DESI-04` `PRES-3` `PRES-4` +4 |
| lac-saint-joseph | 35 | 30 | 12 | `1 H` `100 F` `101 M` `102 F` `103 F` `104 F` `105 F` `17 H` +4 |
| mont-royal | 19 | 191 | 12 | `H-42-G` `H-503` `H-542` `H-60-6` `H-605` `H-617` `H-618` `H-619` +4 |
| montebello | 12 | 40 | 12 | `1-I` `2-A` `24-V` `25-V` `27-A` `29-E` `3-C` `34-H` +4 |
| saint-alexis | 23 | 11 | 12 | `A-302` `H-101` `H-102` `H-103` `H-104` `H-105` `H-106` `H-107` +4 |
| saint-athanase | 14 | 39 | 12 | `EAA-1` `EAB-1` `EAB-2` `EAF-1` `EAF-2` `EAF-3` `EF-1` `M-1` +4 |
| saint-dominique | 62 | 51 | 12 | `Am-3` `I-2` `M-14` `M-15` `M-19` `M-7` `P-1` `P-2` +4 |
| sainte-felicite--la-matanie | 53 | 44 | 12 | `11-Il` `16-R` `28-Aaf` `38-Aaf` `41-Ade` `43-Ad` `44-Ad` `46-Ad` +4 |
| sainte-marie-madeleine | 40 | 29 | 12 | `1002  A21` `1003  A10` `1007 A02` `116` `8040 A21` `8043 A13` `8051  X11` `8054  M09` +4 |
| compton | 100 | 90 | 11 | `A` `C` `F` `H` `H-16` `H-17` `H-18` `HBD` +3 |
| frelighsburg | 11 | 6 | 11 | `AE-4` `AF-1` `AF-2` `AF-3` `AF-30` `AF-31` `RA-15` `RA-30` +3 |
| hemmingford--les-jardins-de-napierville | 89 | 79 | 11 | `AD4` `AF28` `C1` `C12` `C2` `H7` `ID16` `ID17` +3 |
| martinville | 48 | 37 | 11 | `A` `A-1` `A-2` `A-7` `A-9` `F` `M` `P` +3 |
| saint-augustin-de-woburn | 44 | 49 | 11 | `AFT1-1` `AFT1-2` `AFT1-3` `AFT1-4` `AFT1-5` `AFT1-6` `AFT1-7` `IL-1` +3 |
| saint-jean-baptiste | 58 | 49 | 11 | `A-12` `A-4` `A-5` `Cons-1` `Cons-2` `Cons-3` `I-3` `RM-1` +3 |
| saint-thuribe | 30 | 29 | 11 | `Af/a-1` `Af/a-2` `Af/c-1` `Af/c-2` `Af/c-3` `Af/c-4` `Af/c-5` `Fo/u-1` +3 |
| sainte-anne-de-la-rochelle | 61 | 51 | 11 | `AF-2` `AF-6` `AF-9` `AG-2` `CC-1` `CI-1` `ID-06` `PAT-2` +3 |
| bolton-est | 42 | 48 | 10 | `AF-6` `CONS-1` `IDM-6` `RUR-11` `RUR-4` `RUR-ÉCO-3` `RUR-ÉCO-4` `RUR-ÉCO-5` +2 |
| chelsea | 164 | 223 | 10 | `CON-1` `CON-2` `CON-3` `CON-4` `PI-CV-4` `REF-1` `S-CV-10` `V-1` +2 |
| east-angus | 109 | 104 | 10 | `Rc-1` `Rc-10` `Rc-2` `Rc-3` `Rc-4` `Rc-5` `Rc-6` `Rc-7` +2 |
| fassett | 10 | 30 | 10 | `AGR-A-101` `AGR-A-102` `AGR-A-103` `AGR-A-104` `AGR-A-105` `AGR-A-106` `AGR-B-107` `I-A-118` +2 |
| havelock | 11 | 1 | 10 | `A-107` `A-107-1` `AF-108` `AF-108-1` `AF-108-2` `C-104` `H-101` `H-102` +2 |
| kiamika | 49 | 42 | 10 | `A-01` `A-02` `A-03` `A-04` `A-05` `A-06` `A-07` `FR-02` +2 |
| lange-gardien--la-cote-de-beaupre | 10 | 111 | 10 | `Agricole` `Commerciale` `Conservation` `Habitation` `Industrielle` `Mixte` `Publique` `Récréotouristique` +2 |
| padoue | 32 | 43 | 10 | `01 (AIC)` `02 (AIC)` `03 (AGF)` `04 (AGF)` `05 (AGF)` `07 (AGF)` `08 (AIC)` `09 (FRT)` +2 |
| pointe-fortune | 37 | 44 | 10 | `A-5` `A-6` `AREC-1` `MXT-1` `MXT-2` `MXT-3` `R-4` `REC-1` +2 |
| saint-albert | 33 | 25 | 10 | `A1` `A2` `A3` `A4` `A5` `A6` `A7` `A8` +2 |
| saint-amable | 104 | 110 | 10 | `A1-10` `A3-10` `H-4` `H-40` `P-16` `P-17` `P-6` `P-7` +2 |
| saint-hermenegilde | 52 | 42 | 10 | `A` `CO` `F` `M` `PR` `PR-1` `RC` `RC-2` +2 |
| saint-liboire | 64 | 55 | 10 | `H-20` `P-1` `P-2` `P-3` `P-4` `R-1` `ZR-2` `ZR-3` +2 |
| saint-malo | 51 | 46 | 10 | `A` `C` `C-1` `Ci` `F` `P` `P-1` `Ra` +2 |
| saint-neree-de-bellechasse | 45 | 45 | 10 | `100-A` `100-Ha` `11-M` `124-AF-2` `127-AF-2` `128-AF-1` `130-AF-1` `14-M` +2 |
| saint-sylvestre | 40 | 30 | 10 | `24-H` `29.1-CH` `31.1-CH` `33-H` `34-H` `35-P` `35.1-P` `39-A` +2 |
| stanstead-est | 44 | 51 | 10 | `A` `AF` `AF-1` `F` `I` `M` `P` `PE` +2 |
| val-des-bois | 10 | 5 | 10 | `A` `CAM` `CM` `CON` `F` `INS` `REC` `RES` +2 |
| waterville | 92 | 82 | 10 | `A` `AF` `AF-10` `I` `M` `P` `PAT` `R` +2 |
| dixville | 53 | 45 | 9 | `A` `F` `MA` `ML` `P` `P-3` `RP` `RP-5` +1 |
| lac-saguay | 29 | 33 | 9 | `RUR-01` `RUR-02` `RUR-03` `RUR-04` `RUR-05` `RUR-06` `RUR-07` `RUR-08` +1 |
| saint-andre-de-restigouche | 33 | 35 | 9 | `AD-1` `AD-2` `AD-3` `FA-7` `FA-8` `FB-3` `FB-4` `FB-5` +1 |
| saint-gilbert | 29 | 22 | 9 | `Af/a-1` `Af/b-1` `Af/b-2` `C-1` `Ex-1` `I-1` `M-1` `Ra/a-1` +1 |
| saint-laurent-de-lile-dorleans | 42 | 34 | 9 | `A-103` `A-108` `A-401` `CO-401` `CO-801` `CO-802` `R-401` `R-801` +1 |
| vaudreuil-dorion | 279 | 270 | 9 | `INF-1009` `INF-510` `INF-702` `INF-736` `INF-909` `INS-244` `INS-531` `INS-740` +1 |
| waterloo | 118 | 124 | 9 | `C-6` `CONS-108` `CONS-2` `CONS-33` `CONS-59` `CONS-95` `H-116` `H-117` +1 |
| coteau-du-lac | 28 | 112 | 8 | `A-5` `A-6` `A-7` `A-8` `A-9` `ADC-1` `AR-1` `IPFL-1` |
| lac-des-ecorces | 120 | 122 | 8 | `RES-19` `RES-20` `RES-21` `RES-22` `RES-23` `RES-24` `RES-25` `RES-26` |
| piopolis | 70 | 64 | 8 | `AFT1-13` `IL-10` `IL-11` `IL-12` `IL-13` `IL-14` `IL-8` `IL-9` |
| saint-henri | 86 | 94 | 8 | `15-Hc` `20-Ha` `22.1-Ha` `22.2-Ha` `22.3-Ha` `22.4-Ha` `55-M` `57-2-M` |
| saint-urbain | 47 | 40 | 8 | `FOR-3a` `FOR-3b` `FORH-1` `FORH-2` `FORH-3` `FORH-4` `FORH-5` `FORH-6` |
| sainte-justine-de-newton | 14 | 6 | 8 | `A-7` `A-9` `ADR-1` `ADR-2` `ADR-3` `ADR-4` `ADR-5` `AR-1` |
| warwick | 123 | 117 | 8 | `Cons-1` `H-16` `H-19` `H-32` `H-4` `I-11` `RU-11` `RU-12` |
| audet | 44 | 45 | 7 | `IL-51` `IL-52` `IL-53` `IL-54` `IL-55` `IL-56` `IL-57` |
| hampstead | 29 | 22 | 7 | `I-1` `I-2` `I-3` `I-4` `I-6` `I-8` `I-9` |
| ivry-sur-le-lac | 7 | 30 | 7 | `P-1` `P-2` `P-3` `P-4` `V-1` `V-2` `V-3` |
| les-bergeronnes | 23 | 62 | 7 | `114-I` `130-Co` `15-Pr` `203-V` `219-F` `22-I` `232-Fc` |
| lislet | 7 | 160 | 7 | `Ac` `Ac.3` `Ac.5` `Fc` `Fc.3` `V` `V.2` |
| saint-jacques | 28 | 71 | 7 | `D-23` `D-24` `D-25` `D-26` `D-27` `D-29` `D-30` |
| saint-janvier-de-joly | 43 | 37 | 7 | `10-R/C` `11.1-Ra` `13-R/C` `14-P` `16-Ta` `18-C/I` `19-Ta` |
| saint-louis | 41 | 38 | 7 | `503` `509` `510` `511` `514` `A-308` `A-310` |
| saint-octave-de-metis | 33 | 45 | 7 | `01 (CSV)` `02 (ILD)` `03 (AGC)` `04 (AGC)` `05 (AGF)` `06 (AGF)` `09 (AIC)` |
| saint-telesphore | 9 | 9 | 7 | `A1` `A2` `A3` `A4` `A5` `A6` `Cd1` |
| barnston-ouest | 43 | 45 | 6 | `A` `CONS` `F` `Rb` `U` `U-8` |
| donnacona | 171 | 172 | 6 | `Cons-1` `Ra/a-1` `Ra/a-2` `Ra/a-3` `Rm-1` `T-1` |
| lemieux | 12 | 12 | 6 | `AGF-01` `AGF-02` `AGF-03` `AGF-04` `AGF-05` `M-03` |
| notre-dame-auxiliatrice-de-buckland | 54 | 50 | 6 | `123-AF` `124-AF` `153-V` `156-V` `172-F` `174-F` |
| plaisance | 53 | 48 | 6 | `RID-40` `RID-43` `RID-44` `RID-45` `RID-49` `RID-52` |
| saint-aime | 11 | 5 | 6 | `A-1` `A-3` `Cb-1` `Cb-2` `Cr-1` `Rt-1` |
| saint-antonin | 104 | 105 | 6 | `950-PER` `951-PER` `952-PER` `953-PER` `954-PER` `955-PER` |
| saint-felix-dotis | 57 | 85 | 6 | `CE76` `R87` `R88` `R89` `R90` `R91` |
| saint-joseph-de-sorel | 53 | 50 | 6 | `RB-146 (P)` `RC-102` `RC-105 (P)` `RC-109` `RC-119` `RC-122` |
| saint-jules | 30 | 30 | 6 | `A-10` `I-80` `L-91` `M-60` `M-61` `M-62` |
| saint-ludger | 67 | 72 | 6 | `A-10` `IL-60` `IL-61` `IL-62` `IL-63` `REC-3` |
| saint-marc-des-carrieres | 116 | 142 | 6 | `Fo/u-1` `Fo/u-2` `Rb-17` `Rb/a-1` `Rb/a-2` `Rm-1` |
| saint-michel-des-saints | 6 | 21 | 6 | `Va-2` `Vb-1` `Vb-10` `Vb-2` `Vb-6` `Vb-9` |
| saint-philippe | 81 | 102 | 6 | `H-36` `H-40` `H-45` `H-46` `I-04` `P-42` |
| saint-pierre | 11 | 14 | 6 | `I-3` `I-4` `I-5` `I-6` `R-4` `R-5` |
| sainte-barbe | 48 | 43 | 6 | `CO-1` `HA-7` `ID-2` `ID-3` `VA-8a` `VA-8b` |
| bedford--brome-missisquoi | 29 | 69 | 5 | `CB-5` `IC-1` `ID-1` `IE-1` `No.699-1` |
| cowansville | 238 | 243 | 5 | `CBB-6` `P-10` `RAP-1` `RAR-1` `RAV-1` |
| dudswell | 32 | 49 | 5 | `E-1` `E-2` `Rte.112` `Rte.255` `Vil-10` |
| herouxville | 31 | 88 | 5 | `10-Af` `11-Af` `15-Af` `17-Af` `59-Ra` |
| la-trinite-des-monts | 42 | 45 | 5 | `Af-010` `Af-029` `M-118` `M-119` `Rec-115` |
| lac-etchemin | 124 | 124 | 5 | `114-A-ILOT` `58-A-ILOT` `60-A-ILOT` `61-A-ILOT` `66-A-REC` |
| maddington-falls | 22 | 17 | 5 | `R6` `R7` `RU1` `RU2` `RU3` |
| mont-saint-michel | 23 | 21 | 5 | `A-01` `A-02` `A-03` `A-04` `A-05` |
| papineauville | 56 | 51 | 5 | `H-201` `H-221` `H-702` `P-602` `P-605` |
| repentigny | 469 | 465 | 5 | `A1-393` `A2-301` `CON1-197` `P1-447` `P3-048` |
| rosemere | 102 | 163 | 5 | `H-125` `P-1` `P-124` `P-145` `P-63` |
| saint-felicien | 226 | 230 | 5 | `11-1 V` `134 R bmd` `174-1 R md` `317 R hd` `45 P` |
| saint-hilarion | 52 | 47 | 5 | `H-10` `H-11` `H-12` `H-8` `H-9` |
| saint-marcel | 5 | 5 | 5 | `Fc` `Fc.3` `Fc.8` `V` `V.2` |
| saint-robert-bellarmin | 46 | 47 | 5 | `AFT1-10` `IL-58` `IL-59` `P-5` `RU-14` |
| saint-roch-ouest | 5 | 4 | 5 | `A1-1` `A1-2` `A1-3` `A1-4` `A2-5` |
| saint-sulpice | 7 | 31 | 5 | `CON-A` `CON-B` `PUP` `REC` `URB` |
| saint-vallier | 43 | 180 | 5 | `161-E` `162-E` `163-E` `164-E` `17-E` |
| saint-zephirin-de-courval | 16 | 16 | 5 | `H-03` `HC-01` `HC-02` `HC-03` `HC-04` |
| sainte-agathe-de-lotbiniere | 37 | 32 | 5 | `1-Cons` `2-Cons` `3-Cons` `4-Cons` `8-RA` |
| valcourt--le-val-saint-francois | 20 | 60 | 5 | `C-1` `I-2` `VALV-010` `VALV-010-Z01` `no.560` |
| windsor | 76 | 141 | 5 | `REC-1` `REC-4` `Rp-4` `Rp-5` `no.106-2005` |
| dunham | 25 | 78 | 4 | `ID-14-A` `ID-14-B` `ID-2-A` `ID-2-B` |
| howick | 42 | 39 | 4 | `I-1` `Ra-16` `Ra-17` `Rx-1` |
| murdochville | 29 | 30 | 4 | `19-1-P` `27-ZC` `4-C` `7-Ha-1` |
| notre-dame-de-lourdes--lerable | 38 | 40 | 4 | `A-12` `A-13` `A-2` `A-3` |
| notre-dame-de-pontmain | 52 | 48 | 4 | `A-01` `REF-07` `URB-01` `VIL-13` |
| peribonka | 25 | 72 | 4 | `113-1 C` `113-2 C` `118 PR` `119 Pr` |
| rapide-danseur | 30 | 31 | 4 | `F3` `F4` `F5` `J1` |
| saint-alphonse-de-granby | 23 | 526 | 4 | `CONS` `RAT` `REC-I` `Raa` |
| saint-ambroise | 52 | 132 | 4 | `102 R Bd` `210 Id` `37 A dev` `39-1 A dyn` |
| saint-bernard-de-michaudville | 39 | 35 | 4 | `511` `512` `C-101` `H-108` |
| saint-cyrille-de-lessard | 4 | 41 | 4 | `Fc` `Fc.2` `Fc.3` `Fc.7` |
| saint-gervais | 36 | 35 | 4 | `12-M` `163-V` `24-M` `8-Ha` |
| saint-martin | 5 | 26 | 4 | `AUc` `AUs` `N` `U` |
| saint-zacharie | 58 | 54 | 4 | `29-F` `45-AF` `53-ID` `54-F` |
| baie-des-sables | 3 | 19 | 3 | `35 (AGF)` `36 (AGC)` `37 (AGC)` |
| bury | 58 | 73 | 3 | `R-7` `R-8` `R-9` |
| champlain | 65 | 64 | 3 | `C-215` `I-215` `P-132` |
| chute-saint-philippe | 36 | 51 | 3 | `A-01` `CONS-02` `CONS-03` |
| lac-du-cerf | 31 | 30 | 3 | `IND-01` `REC-06-01` `REC-06-02` |
| marston | 44 | 46 | 3 | `AFT1` `IL-29` `IL-30` |
| richmond | 74 | 105 | 3 | `AFD-1` `IRd-1` `Z-01` |
| saint-camille-de-lellis | 3 | 22 | 3 | `Fc` `Fc.10` `Fc.8` |
| saint-denis-de-la-bouteillerie | 22 | 19 | 3 | `17RZ` `1PI` `6V` |
| saint-denis-sur-richelieu | 70 | 68 | 3 | `A-16` `P-30` `P-31` |
| saint-elzear--la-nouvelle-beauce | 50 | 80 | 3 | `B-5` `C-1` `PZ-2` |
| saint-guillaume | 56 | 55 | 3 | `Ha-13` `Ib-4` `Vd-2` |
| saint-joachim-de-shefford | 38 | 131 | 3 | `AFL-1` `AFL-2` `CI-1` |
| saint-luc-de-bellechasse | 26 | 24 | 3 | `25-ID` `26-H` `27-ID` |
| saint-mathieu-de-beloeil | 54 | 62 | 3 | `H-52` `IDC-32-1` `IDC-32-2` |
| saint-rene-de-matane | 43 | 42 | 3 | `20-Il` `40-Cv` `51-Il` |
| saint-sauveur | 140 | 144 | 3 | `H-204` `H-252` `HT-310` |
| saint-tite | 108 | 179 | 3 | `138-Ra` `197-C` `93-Ca` |
| sainte-famille-de-lile-dorleans | 67 | 64 | 3 | `CM-201` `M-201` `M-202` |
| sainte-rose-de-watford | 48 | 46 | 3 | `10-H` `42-ID` `49-H` |
| stukely-sud | 46 | 53 | 3 | `EXT-1` `ID-11` `VILL-1` |
| ulverton | 56 | 172 | 3 | `EXT-1` `P-3` `RT-1` |
| amherst | 43 | 98 | 2 | `96-V` `97-F` |
| bedford--brome-missisquoi--2 | 73 | 72 | 2 | `IB-5` `RB-4` |
| cookshire-eaton | 27 | 175 | 2 | `C0-001` `I-002` |
| dorval | 220 | 221 | 2 | `I04-05` `P01-45` |
| durham-sud | 62 | 61 | 2 | `ID-14` `RU-10` |
| franklin | 82 | 86 | 2 | `HA-1-2` `HA-19` |
| hemmingford--les-jardins-de-napierville--2 | 38 | 43 | 2 | `IN-1` `IN-2` |
| lotbiniere | 25 | 25 | 2 | `AD-30` `CONS-28` |
| rigaud | 44 | 161 | 2 | `H-1` `P-9` |
| saint-ambroise-de-kildare | 147 | 145 | 2 | `Pr1` `Pr2` |
| saint-etienne-de-beauharnois | 44 | 44 | 2 | `AG-C-231` `AG-D-122` |
| saint-gedeon | 76 | 79 | 2 | `104-Adyn` `120-Rbd` |
| saint-joseph-de-lepage | 31 | 30 | 2 | `01 AGF)` `34 (RCT)` |
| saint-mathieu-dharricana | 47 | 46 | 2 | `VC-8` `VC-9` |
| saint-moise | 51 | 51 | 2 | `43 Ha` `55 I` |
| saint-simeon--charlevoix-est | 55 | 53 | 2 | `HA-116` `MR-33` |
| sainte-anne-des-lacs | 36 | 35 | 2 | `P-401` `PAE-03` |
| sainte-elizabeth-de-warwick | 14 | 13 | 2 | `A1` `R10` |
| sainte-helene-de-kamouraska | 21 | 19 | 2 | `11CZ` `12CZ` |
| sainte-perpetue--nicolet-yamaska | 25 | 24 | 2 | `H-07` `V-01` |
| temiscaming | 129 | 135 | 2 | `CA-11` `IB-3` |
| val-david | 32 | 66 | 2 | `A15` `EF-08` |
| val-racine | 34 | 35 | 2 | `IL-6` `IL-7` |
| berry | 34 | 34 | 1 | `VD-2` |
| causapscal | 159 | 160 | 1 | `2 Av` |
| chambord | 61 | 80 | 1 | `22R` |
| charlemagne | 1 | 47 | 1 | `URB` |
| cleveland | 121 | 247 | 1 | `CI1` |
| delson | 97 | 102 | 1 | `P-2` |
| duparquet | 47 | 46 | 1 | `Pc-8` |
| grand-metis | 26 | 25 | 1 | `27 (VLG)` |
| grosses-roches | 38 | 37 | 1 | `15-P` |
| kingsbury | 20 | 131 | 1 | `RT-1` |
| lac-au-saumon | 138 | 137 | 1 | `50 Hc` |
| lac-sergent | 20 | 25 | 1 | `12-R` |
| lacolle | 30 | 92 | 1 | `RU-2021-0204` |
| leclercville | 28 | 27 | 1 | `P-5` |
| metis-sur-mer | 65 | 74 | 1 | `30 (VLG)` |
| mont-tremblant | 626 | 650 | 1 | `TM-661` |
| oka | 103 | 132 | 1 | `RM-16` |
| paspebiac | 128 | 128 | 1 | `240-P` |
| ragueneau | 122 | 122 | 1 | `H133` |
| sacre-coeur | 23 | 55 | 1 | `16-H` |
| saint-alexis-de-matapedia | 36 | 35 | 1 | `AB-4` |
| saint-antoine-sur-richelieu | 69 | 68 | 1 | `P-5` |
| saint-barnabe-sud | 4 | 27 | 1 | `8031  A21` |
| saint-cyrille-de-wendover | 17 | 49 | 1 | `IDa` |
| saint-dominique-du-rosaire | 30 | 40 | 1 | `PC-6` |
| saint-edmond-les-plaines | 32 | 32 | 1 | `CE-33` |
| saint-flavien | 51 | 50 | 1 | `26-AD` |
| saint-joseph-de-kamouraska | 15 | 14 | 1 | `15RZI` |
| saint-noel | 53 | 52 | 1 | `61 Ha` |
| saint-pierre-baptiste | 57 | 58 | 1 | `A/R-1` |
| saint-pierre-de-lile-dorleans | 67 | 66 | 1 | `A-122` |
| saint-prosper | 97 | 97 | 1 | `82-C` |
| saint-sixte | 13 | 23 | 1 | `Ect-1` |
| saint-zenon-du-lac-humqui | 43 | 42 | 1 | `48 P` |
| sainte-marguerite-marie | 35 | 35 | 1 | `39 Ha` |
| stanbridge-east | 21 | 29 | 1 | `C1-13` |
| stoke | 53 | 132 | 1 | `AFD-7` |
| stratford | 50 | 86 | 1 | `ÎL-86` |
| sutton | 95 | 166 | 1 | `C-06` |

## normes-source-gap (146) — mismatch NON évaluable

Munis servis SANS normes déposées: mismatch/fraîcheur non mesurable (absence de normes ≠ match).

