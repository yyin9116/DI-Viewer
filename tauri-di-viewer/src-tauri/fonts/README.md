# Bundled typeface

`SarasaGothicSC-Regular.woff2` and `SarasaGothicSC-SemiBold.woff2` are the two
weights the shell's design system asks for. Sarasa is **not** a Windows font, so
it ships inside the app instead of relying on what the machine happens to have.

| | |
|---|---|
| Family | Sarasa Gothic SC (`name` table ID 1: `Sarasa Gothic SC`) |
| Upstream | https://github.com/be5invis/Sarasa-Gothic |
| Release | `SarasaGothicSC-TTF-Unhinted-1.0.42.7z` |
| Bundled files | `SarasaGothicSC-Regular.ttf`, `SarasaGothicSC-SemiBold.ttf` |
| Conversion | `woff2_compress` only — no subsetting, no glyph edits |
| License | SIL Open Font License 1.1 — see [`OFL.txt`](OFL.txt) |

Full character sets are kept on purpose: subsetting would silently drop rare
CJK glyphs. The cost is ~10 MB of binary, which is why the two files are
embedded with `include_bytes!` and served over the `diviewer://` scheme rather
than copied next to the executable — a portable single-file build still has to
render Chinese.

`OFL.txt` must stay in this directory: OFL 1.1 requires the license to travel
with the font when it is redistributed.
