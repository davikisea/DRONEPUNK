# Referencia Algorítmica Canónica — SPRITE-FORGE-STUDIO (`09_city_world_engine.py` v6.0.0-awbw)

Fuente verificada de solo lectura: `C:\Users\Usuario\SPRITE-FORGE-STUDIO\src\09_city_world_engine.py` y `config\city_worldgen_presets.json`.

---

## 1. Constantes de Escala (`SCALE_SPEC`, `L133-200`)

| Escala | Tier DRONEPUNK | `min/target/max_bldgs` | `min/max_area` | `min_fill` | `min_rbts` / `rbt_r` | `min_quads` / `min_grains` | `air_required` | `notch_hw` | `min/target_crowns` |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `x3` | `T5_METROPOLIS_X3` | `180 / 222 / 280` | `780 / 1150` | `0.24` | `2 / 3 (7x7)` | `4 / 4` | `true` | `3` | `30 / 48` |
| `x2` | `T4_CONURBATION_X2` | `110 / 134 / 155` | `480 / 680` | `0.22` | `1 / 2 (5x5)` | `4 / 3` | `true` | `3` | `20 / 34` |
| `x1` | `T3_REGIONAL_HUB_X1` | `55 / 72 / 90` | `260 / 440` | `0.16` | `1 / 2 (5x5)` | `2 / 2` | `false` | `2` | `12 / 22` |
| `sat_hub` | `T2_MUNICIPAL_HUB_SAT` | `16–19` | `33x33` | — | `1 / 2 (5x5)` | `3` | `false` | `2` | `8–12` |
| `sat_outpost` | `T1_OUTPOST_SAT` | `16–17` | `33x33` | — | `1 / 1 (3x3)` | `2` | `false` | `1` | `6–10` |

---

## 2. Primitivas Geométricas y Morfológicas (`L895-1047`)

1. **`_chaikin_smooth(pts, passes=2)` (`L984-995`)**:
   - En cada pasada, por cada arista `(p0, p1)` emite dos puntos: `0.78 * p0 + 0.22 * p1` y `0.22 * p0 + 0.78 * p1`.
2. **`_rasterize_polygon(verts, h, w)` (`L998-1027`)**:
   - Ray-casting con desplazamiento `+0.01` en `(x, y)` dentro del bounding box exacto.
3. **`_clean_lobe_mask(raw, cx, cy, border_margin)` (`L1030-1046`)**:
   - Aplica margen de borde -> `_fill_holes` -> retiene componente conectada del centro `(cx, cy)` -> `_keep_only_3x3_blocks` -> `_fill_holes` -> `_keep_only_3x3_blocks` -> retiene componente del centro.
4. **`extract_thin_ring(mask)` (`L924-962`)**:
   - `e4 = mask & (~erode4(mask))`.
   - Puentea esquinas diagonales (`a && d && !b && !c` o `b && c && !a && !d`) eligiendo el vecino interior que no genere blob `2x2`.
   - Ejecuta `peel_2x2(ring)` (`L895-921`) y poda cualquier espolón con `deg < 2`.
5. **`_max_empty_square_side(mask)` (`L965-981`)**:
   - Programación dinámica exacta: `dp[y][x] = 1 + min(dp[y-1][x], dp[y][x-1], dp[y-1][x-1])`. Debe cumplir `<= 3` al finalizar Fase 7c.

---

## 3. 5 Familias de Silueta (`_silhouette_mask_from_family`, `L1259-1355`)

Coordenadas locales rotadas por `-angle_rad`: `lx = dx*cos - dy*sin`, `ly = dx*sin + dy*cos`, `sf = max(0.55, scale_factor)`:
1. **`multi_ellipse_metaball`**: `n_lobes in [2..4]`, campo `sum(exp(-((ux/rx)^2 + (uy/ry)^2))) >= 0.52`.
2. **`coastal_arc_crescent`**: Creciente cóncavo asimétrico abrazando `wf_dir`, con `half_thick` asimétrico `(1.0 + 0.24 * clip(u_norm, -1, 1))` para romper simetría espejo (`internal_mirror_iou <= 0.78`) y sustracción circular de bahía (`bay_dist >= bay_r * 0.72`).
3. **`river_corridor_split`**: Doble lóbulo asimétrico (`lobe_a | lobe_b | waist`) con cintura estrecha (`waist_h = max(3.8, (6.8 - concavity * 6.0) * sf)`).
4. **`alpine_wedge_terrace`**: Anfiteatro escalonado en 3 terrazas cuantizadas (`tier = floor(t_y * 3) / 3`) + ala lateral (`wing`).
5. **`harmonic_fourier_polygon`**: Polígono de 20 vértices (`r0 = 17.0 * sf`) modulado por hasta 4 armónicos `[0.18, -0.11, 0.06]`, clampeado a `[0.50, 1.52]` y suavizado con `_chaikin_smooth`.

---

## 4. Variabilidad y Anti-Colisión (`L1079-1256`)

- **`apply_anti_collision_repairs` (`AC-01..AC-07`)**:
  - `AC-01`: Si `wf_dir == "none"`, prohibir `coastal_arc_crescent`, `coastal_promenade`, `coast_parallel_bands` y `COASTAL_ARC`.
  - `AC-02`: Si `!river_present`, prohibir `river_corridor_split` y `bi_bank_bridges`.
  - `AC-03`: `monumental_bridge` requiere `wf_dir != "none"` o `river_present`.
  - `AC-04`: En `x1`, limitar `sector_count <= 4` (objetivo 3) y prohibir `twin_plaza_dumbbell` / `radial_annular`.
  - `AC-05`: `tangential_beltway` / `s_spine_collector` + `divided_stem` -> `terminal_mode = "t_plaza"`.
  - `AC-06`: `air_hub` jamás puede tener orientación `BLOCK_INTEGRATED` (forzar `EW`).
  - `AC-07`: Garantizar `>= min(K, 3)` gramáticas `micro_grain` distintas por ciudad.
- **`max_d4_iou(mask_a, mask_b, size=32)` (`L1090-1102`)**: Máxima IoU entre `mask_a` y las 8 transformaciones diédricas ($D_4$: 4 rotaciones × 2 reflejos) de `mask_b`.
- **`_compute_topo_signature` (`L1105-1138`)**: Vector 9D `[deg2, deg3, deg4, cyclo, rbt_dens, orient_aniso, diag_ratio, bbox_elong, fill_dens]`.

---

## 5. Partición Polimórfica de Sectores (`L3089-3158`)

1. **`coast_parallel_bands`**: BFS desde `water_grid` -> cuantiles de distancia para asignar `sid in [0..k_sec-1]`.
2. **`elevation_terraces`**: Proyección lineal rotada `(x - cx_rb)*sin(ang_t) + (y - cy_rb)*cos(ang_t)` -> cuantiles.
3. **`voronoi_geodesic`**: Multi-source BFS sobre `inland_real` desde `k_sec` semillas distribuidas angularmente.
4. **`non_orthogonal_angular`**: Cuantiles de `(atan2(y - cy_rb, x - cx_rb) - ang_off) mod 2pi`.

---

## 6. Planificador de Distritos Funcionales (`L3200-3686`)

- **`_can_place_rect_strip(rx0, ry0, rw, rh)`**: Verifica que el interior esté libre y en `inland_real`, y que el collar exterior de 1 tile no tenga edificios ni carreteras paralelas adyacentes (evita blobs `2x2`).
- **`_stamp_rect_road_ring(rx0, ry0, rw, rh)`**: Estampa el perímetro vial sin blobs `2x2` y conecta **2 esquinas opuestas** `(rx0, ry0)` y `(rx0+rw-1, ry0+rh-1)` a `main_hub_pt` vía `_trace_4conn_no_2x2`.
- **Orden de colocación obligatorio**:
  1. **`waterfront_port` (`L3286-3395`)**: Sobre costa navegable con `min_sep = 4` (si `>= 4` puertos) o `2`, paseo interior `lx + in_dx`, puerto en `lx`, almacén en `lx + 2*in_dx` y reconexión de extremos.
  2. **`air_hub` (`L3405-3496`)**: Tira `12x4` (`x3`) / `10x4` (`x2`) en `EW` o `NS`, pista libre (`runway_clear_mask`), corredores de vuelo y edificios `airport` + `base`.
  3. **`civic_core` (`L3498-3565`)**: Tira `11x3` (`x3`) / `9x3` (`x2`/`x1`) o `L_SHAPED`, con `hq` central flanqueado por parques (`wood`) y `city`.
  4. **`industrial_logistics_park` (`L3567-3648`)**: Tira `15x4`/`13x4`/`11x4` (`x3`) o `11x4`/`9x4`/`7x3` (`x2`/`x1`), alternando `factory`, `base`, `silo`, `usedSilo` con pantalla de parques para respetar North Setback.
  5. **`science_campus` (`L3650-3682`)**: Tira `9x4` (`x3`) / `7x4` (`x2`), combinando `lab`, `commtower`, `city` y patio verde.
- **Invariante DRONEPUNK**: Todos los edificios colocados en todos los distritos usan `ownerId: null` (`Neutral/*.png`) y `base` se mapea al tipo canónico `factory` de DRONEPUNK.

---

## 7. Micro-Grains, Fase 7 y K-Core (`L3687-4165`)

- **9 Gramáticas** en `q_allowed = sector_mask & ~blocked_dist & ~rbt_protect_mask & ~approach_protected & ~buildings`:
  `curved_arc` (arcos elípticos `r = 6.5..24.0` paso `3.5` + costillas cada `5`), `diagonal_terrace` (diagonales dobles cada `5` + terrazas E-O cada `5`), `ns_bars` (cada `2` cols), `ew_bars` (cada `2` filas), `superblock_central_park` (`5x5` + parque en `+4,+4`), `courtyard_cloisters` (`4x4` + parque en `+3,+3`), `comb_piers` (dedos cada `3` + colector medio), `organic_loops` (paso `3/4` alternado), `divided_borough` (`3x4`).
- **Reconexión y Cierre**: `_trace_4conn_no_2x2` (4 pasadas) + `_close_loop_from_deg1(..., max_len=8)` (8 pasadas).
- **Fase 7a/7b/7c**: Cuota por cuadrante (`min_quad_b + 2`) con `~12.5%` parques -> top-up hasta `max(min_bldgs, ceil(min_fill * dry_area))` -> eliminación iterativa de cualquier cuadrado vacío `>= 4x4` (`_max_empty_square_side <= 3`).
- **K-Core Final (`L4082-4165`)**: Simula poda `deg < 2`, rescata edificios sin acceso vial con hasta **2 piernas** al grafo principal `surv_main`, aplica `peel_2x2`, y convierte en `wood` cualquier `city` sobrante desconectada.

---

## 8. 5 Familias Orgánicas de Pueblos Satélite (`_synthesize_organic_sat_layout`, `L4430-4530`)

Lienzo local `33x33` (`c_l = 16`), polígonos de 8–9 vértices con jitter determinista `±6%`, Chaikin `passes=2`, `_clean_lobe_mask(..., border_margin=2)`, `extract_thin_ring` y rotonda `5x5` (`r=2`) o `3x3` (`r=1`):
1. `highway_roundabout_hub` (`r=2`, `roundabout_5x5_y_entry`, 19 bldgs)
2. `harbor_promenade_cove` (`r=1`, `quay_promenade`, 16 bldgs)
3. `ridge_terrace_citadel` (`r=1`, `roundabout_3x3_bypass`, 17 bldgs)
4. `riverbend_mill_hamlet` (`r=1`, `roundabout_3x3_y_entry`, 17 bldgs)
5. `industrial_freight_crescent` (`r=1`, `y_junction_bypass`, 17 bldgs)
