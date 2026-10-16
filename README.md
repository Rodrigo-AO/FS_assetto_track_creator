# Assetto Track Creator

Diseña circuitos de conos tipo Formula Student sobre el mapa satélite y expórtalos como pista jugable de **Assetto Corsa**.

## Arranque

```bash
npm install
npm run dev
```

Abre http://localhost:5173. Para instalar las pistas directamente en el juego, la app busca Assetto Corsa en las bibliotecas de Steam; si está en otro sitio, arráncala con `ATC_AC_PATH=<carpeta de assettocorsa>`.

## Uso rápido

1. **Crear circuito** → *Delimitar área* (polígono o rectángulo). Fuera del área el mapa se oscurece y se activan el resto de herramientas.
2. **Track creator**: traza la pista por puntos, con la pluma Bézier o a mano alzada. Ancho de 3 m por defecto (simétrico o por lado, arrastrando los bordes discontinuos) y conos automáticos cada 5 m: azules a la izquierda y amarillos a la derecha.
3. **Salida / Meta** (obligatoria) y **Sectores**: clic sobre la pista.
4. **Conos** manuales (azul, amarillo, naranja, naranja grande), con o sin hitbox, y **Tipo de suelo** (asfalto, césped o grava).
5. **Exportar** → *Instalar en Assetto Corsa* o *Descargar ZIP*.

## Desarrollo

| Comando | |
|---|---|
| `npm test` | Tests (Vitest) |
| `npm run typecheck` | TypeScript estricto |
| `npm run build` | Build de producción |
| `npx vite-node scripts/export-sample.ts <carpeta>` | Exporta un circuito de ejemplo |

La documentación completa (arquitectura, formato de pista de AC, decisiones y backlog) está en Obsidian: `04 - Memoria Claude/assetto_track_creator`.
