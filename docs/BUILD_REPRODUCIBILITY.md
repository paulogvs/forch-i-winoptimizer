# Build reproducible — resolución de `@shared/*`

> **FORCH.iA WinOptimizer v0.7.0** — deuda de build resuelta.
>
> Built with FORCH.i by Paulo Velasco.

## Síntoma

En una máquina recién clonada (o tras `npm ci` / reinstalar `node_modules`), el E2E
con **Electron real** fallaba al arrancar el proceso _main_:

```
Error: Cannot find module '@shared/security-scan'
```

El E2E de navegador no lo detectaba porque mockea la API; solo el E2E de Electron real
ejercita el _main_ compilado.

## Causa

El _main_ y el _preload_ se compilan con `tsc -p tsconfig.main.json` a **CommonJS**, y
el alias `@shared/* -> src/shared/*` de `tsconfig` es una función **solo de
compilación**: `tsc` **no reescribe** los `require()` emitidos. Entonces
`import { X } from '@shared/security-scan'` se emitía como
`require("@shared/security-scan")`, que Node no sabe resolver en runtime.

El workaround anterior eran **10 paquetes shim creados a mano** dentro de
`node_modules/@shared/` (`electron-api`, `scan-progress`, `security-scan`, `settings`,
`shared`, `stats`, `tweaks`, `types`, `updater-status`, `windows-tools`). Cada shim era
un `index.js` con una **ruta absoluta** a `dist/shared/<x>.js`. Como `node_modules` está
**gitignoreado**, esos shims no viajaban en el repo (y además la ruta absoluta era
específica de una máquina). Resultado: build **no reproducible**.

## Arreglo (v0.7.0)

Se registra la resolución del alias **en runtime desde el propio main**, sin escribir
nada en `node_modules`:

- `src/main/register-shared-alias.ts` parchea una sola vez
  `Module._resolveFilename` (CommonJS) mapeando `@shared/<x>` a
  `path.join(__dirname, '..', 'shared', <x>)` — es decir, `dist/shared/<x>`, porque en
  runtime `__dirname` es `dist/main`.
- Se importa **primero** en `src/main/index.ts`, antes que cualquier módulo que
  requiera `@shared/*`. El resolver es idempotente (marca de guarda) para no
  doble-envolver si un test lo importa varias veces.
- El **preload** usa imports relativos (no necesita mapeo).
- El **renderer** es empaquetado por **Vite**, que ya resuelve `@shared` con su
  propio `resolve.alias`; el bundle final no contiene `require("@shared/...")`.

Nada de magia en `node_modules`: el mapeo vive en el código commiteado y sobrevive a
cualquier reinstalación.

## Verificación (aceptación)

1. Se **borraron** los 10 directorios `node_modules/@shared/*`.
2. `npm run test:e2e:electron` (que hace `npm run build` primero) sigue pasando
   **1/1**: el Electron real arranca, renderiza la app y el escaneo de seguridad
   devuelve datos reales de la máquina.
3. `npm run electron:build` sigue OK (el instalador se empaqueta con el resolver
   incluido en `dist/main`).

```bash
# Comprobación de que no queda ningún shim
Test-Path node_modules/@shared          # → False
Get-ChildItem dist/main/register-shared-alias.js   # → existe
```
