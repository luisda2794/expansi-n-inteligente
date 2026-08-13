# Expansión Inteligente

Crea una app llamada "EXPANSION RUTAS" para analizar rutas de última milla y planificar expansión geográfica. Necesito dos secciones principales:

1) SUBIR EPOD: una pantalla donde pueda subir un archivo Excel (.xlsx) tipo EPOD (exportado de Cainiao, columnas incluyen Waybill Number/Número de Waybill, Task Date/Fecha de la tarea, Task Status/Estado de la Tarea, Zip Code/Código postal, DSP Name/Nombre de DSP, Courier Name/Nombre del Repartidor - los nombres de columna pueden venir en inglés o español). Al subir el archivo, la app debe:
   - Detectar automáticamente todos los códigos postales (CP) presentes
   - Detectar qué empresa/DSP lleva cada CP
   - Calcular el volumen medio diario de paquetes por CP (total de paquetes de ese CP dividido entre el número de días distintos que aparecen en el archivo)
   - Mostrar una tabla resumen: CP | Empresa/DSP | Volumen medio diario | Localidad (si se puede inferir)
   - Permitir subir varios EPODs a lo largo del tiempo y que el histórico se vaya acumulando (guardar en base de datos, no solo en memoria de sesión)

2) CPs DE EXPANSIÓN: una sección donde yo pueda añadir manualmente códigos postales candidatos a expansión, con estos campos editables: Código Postal, Localidad, Volumen diario estimado (yo lo introduzco a mano), Empresa que lo lleva actualmente (opcional), Notas. Debe permitir añadir, editar y eliminar entradas, y verlas en una tabla ordenable por CP o por volumen.

Diseño: limpio, tipo dashboard operativo/logística, con buena legibilidad de tablas numéricas. Idioma de la interfaz: español.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bb870308-fe37-4a6b-806f-43ec5feca802).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
