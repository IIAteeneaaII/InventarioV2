# Sistema de Reparaciones - Documentación Completa

## Descripción General

El sistema de reparaciones permite gestionar el proceso completo de diagnóstico y reparación de equipos, incluyendo:
- Códigos de daño estandarizados (D000-D025, B001-B002)
- Códigos de reparación categorizados (N001-N016, SC1-SC3)
- Flujo de trabajo entre Test Inicial y Reparación
- Seguimiento completo del historial de reparaciones

## Estructura del Sistema

### Roles Involucrados

1. **UTI (Usuario Test Inicial)**: Realiza diagnósticos iniciales y marca equipos para reparación
2. **URep (Usuario Reparación)**: Ejecuta las reparaciones y actualiza el estado final

### Base de Datos

#### Enums Principales

```javascript
// Niveles de reparación
enum NivelReparacion {
  NIVEL_1    // Reparaciones básicas (códigos N)
  NIVEL_2    // Reparaciones de soldadura (códigos SC)
}

// Estados de reparación
enum EstadoReparacion {
  PENDIENTE       // Esperando diagnóstico
  EN_DIAGNOSTICO  // UTI realizando diagnóstico
  REQUIERE_REPARACION // Enviado a URep
  EN_REPARACION   // URep trabajando
  COMPLETADA      // Reparación finalizada
  NO_REPARABLE    // Equipo descartado
}
```

#### Tablas de Códigos

##### CodigoDano
- **D000-D025**: Códigos de daño específicos
- **B001-B002**: Códigos de daño en bloque

##### CodigoReparacion  
- **N001-N016**: Reparaciones de Nivel 1 (básicas)
- **SC1-SC3**: Reparaciones de Nivel 2 (soldadura)

### API Endpoints

#### Para Usuario Test Inicial (UTI)

```javascript
// Registrar diagnóstico inicial
POST /api/reparacion/diagnostico
Headers: Authorization: Bearer <token>
Body: {
  sn: "SERIAL123",
  codigosDano: ["D001", "D005"],  // Array de códigos
  observaciones: "Descripción del problema",
  requiereReparacion: true
}

// Obtener códigos de daño disponibles
GET /api/reparacion/codigos-dano
Response: [
  { codigo: "D000", descripcion: "Sin daño aparente", activo: true },
  { codigo: "D001", descripcion: "Daño en carcasa", activo: true },
  ...
]

// Obtener historial de reparaciones
GET /api/reparacion/historial/:sn
Response: {
  sn: "SERIAL123",
  reparaciones: [...]
}
```

#### Para Usuario Reparación (URep)

```javascript
// Completar reparación
POST /api/reparacion/completar
Body: {
  reparacionId: 123,
  codigosReparacion: ["N001", "SC2"],
  exitosa: true,
  observaciones: "Reparación completada correctamente"
}

// Obtener códigos de reparación
GET /api/reparacion/codigos-reparacion
Response: [
  { codigo: "N001", descripcion: "Limpieza general", nivel: "NIVEL_1" },
  { codigo: "SC1", descripcion: "Soldadura de componente", nivel: "NIVEL_2" },
  ...
]

// Obtener equipos pendientes de reparación
GET /api/reparacion/pendientes
Response: [
  {
    id: 123,
    sn: "SERIAL123",
    codigosDano: ["D001"],
    fechaCreacion: "2025-09-08T21:00:00Z",
    observaciones: "Problema detectado"
  }
]
```

## Implementación Frontend

### 1. Vista de Test Inicial (UTI)

#### Archivo: `views/formato_general/[SKU].ejs`

Agregar la siguiente sección después del formulario principal de escaneo:

```html
<!-- Sección de Diagnóstico de Reparaciones -->
<div class="card mt-4" id="seccion-diagnostico" style="display: none;">
    <div class="card-header bg-warning">
        <h5 class="mb-0">🔧 Diagnóstico de Reparación</h5>
    </div>
    <div class="card-body">
        <form id="form-diagnostico">
            <input type="hidden" id="sn-diagnostico" name="sn">
            
            <!-- Códigos de Daño -->
            <div class="mb-3">
                <label class="form-label fw-bold">Códigos de Daño:</label>
                <div id="codigos-dano-container" class="row">
                    <!-- Se llenarán dinámicamente via JavaScript -->
                </div>
            </div>
            
            <!-- Observaciones -->
            <div class="mb-3">
                <label for="observaciones-diagnostico" class="form-label">Observaciones:</label>
                <textarea class="form-control" id="observaciones-diagnostico" name="observaciones" rows="3" 
                          placeholder="Describe el problema detectado..."></textarea>
            </div>
            
            <!-- Requiere Reparación -->
            <div class="form-check mb-3">
                <input class="form-check-input" type="checkbox" id="requiere-reparacion" name="requiereReparacion">
                <label class="form-check-label fw-bold text-danger" for="requiere-reparacion">
                    ⚠️ Este equipo requiere reparación
                </label>
            </div>
            
            <div class="d-grid gap-2">
                <button type="submit" class="btn btn-warning btn-lg">
                    📋 Registrar Diagnóstico
                </button>
                <button type="button" class="btn btn-secondary" onclick="cancelarDiagnostico()">
                    Cancelar
                </button>
            </div>
        </form>
    </div>
</div>

<!-- Modal para Historial de Reparaciones -->
<div class="modal fade" id="modalHistorial" tabindex="-1">
    <div class="modal-dialog modal-lg">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">📋 Historial de Reparaciones</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" id="historial-content">
                <!-- Contenido del historial -->
            </div>
        </div>
    </div>
</div>
```

#### JavaScript para Test Inicial

Agregar al final del archivo, antes del `</body>`:

```html
<script>
let codigosDanoDisponibles = [];

// Cargar códigos de daño al inicializar la página
document.addEventListener('DOMContentLoaded', function() {
    cargarCodigosDano();
    
    // Agregar botón de diagnóstico al formulario principal
    const formPrincipal = document.querySelector('form');
    if (formPrincipal) {
        const btnDiagnostico = document.createElement('button');
        btnDiagnostico.type = 'button';
        btnDiagnostico.className = 'btn btn-warning mt-2';
        btnDiagnostico.innerHTML = '🔧 Diagnosticar para Reparación';
        btnDiagnostico.onclick = mostrarDiagnostico;
        formPrincipal.appendChild(btnDiagnostico);
    }
});

async function cargarCodigosDano() {
    try {
        const response = await fetch('/api/reparacion/codigos-dano');
        codigosDanoDisponibles = await response.json();
        renderizarCodigosDano();
    } catch (error) {
        console.error('Error cargando códigos de daño:', error);
    }
}

function renderizarCodigosDano() {
    const container = document.getElementById('codigos-dano-container');
    container.innerHTML = '';
    
    codigosDanoDisponibles.forEach(codigo => {
        if (codigo.activo) {
            const div = document.createElement('div');
            div.className = 'col-md-6 col-lg-4 mb-2';
            div.innerHTML = `
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" 
                           id="dano-${codigo.codigo}" name="codigosDano" value="${codigo.codigo}">
                    <label class="form-check-label small" for="dano-${codigo.codigo}">
                        <strong>${codigo.codigo}</strong>: ${codigo.descripcion}
                    </label>
                </div>
            `;
            container.appendChild(div);
        }
    });
}

function mostrarDiagnostico() {
    const snInput = document.querySelector('input[name="sn"]');
    if (!snInput || !snInput.value.trim()) {
        Swal.fire('Error', 'Primero ingresa un número de serie', 'error');
        return;
    }
    
    document.getElementById('sn-diagnostico').value = snInput.value.trim().toUpperCase();
    document.getElementById('seccion-diagnostico').style.display = 'block';
    document.getElementById('seccion-diagnostico').scrollIntoView({ behavior: 'smooth' });
}

function cancelarDiagnostico() {
    document.getElementById('seccion-diagnostico').style.display = 'none';
    document.getElementById('form-diagnostico').reset();
}

// Manejar envío del formulario de diagnóstico
document.getElementById('form-diagnostico').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = new FormData(this);
    const codigosDano = Array.from(document.querySelectorAll('input[name="codigosDano"]:checked'))
                             .map(cb => cb.value);
    
    if (codigosDano.length === 0) {
        Swal.fire('Error', 'Selecciona al menos un código de daño', 'error');
        return;
    }
    
    const data = {
        sn: formData.get('sn'),
        codigosDano: codigosDano,
        observaciones: formData.get('observaciones'),
        requiereReparacion: formData.get('requiereReparacion') === 'on'
    };
    
    try {
        const response = await fetch('/api/reparacion/diagnostico', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            Swal.fire('Éxito', 'Diagnóstico registrado correctamente', 'success');
            cancelarDiagnostico();
        } else {
            Swal.fire('Error', result.error || 'Error al registrar diagnóstico', 'error');
        }
    } catch (error) {
        Swal.fire('Error', 'Error de conexión', 'error');
        console.error('Error:', error);
    }
});

// Función para ver historial de reparaciones
async function verHistorialReparaciones() {
    const snInput = document.querySelector('input[name="sn"]');
    if (!snInput || !snInput.value.trim()) {
        Swal.fire('Error', 'Primero ingresa un número de serie', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/reparacion/historial/${snInput.value.trim()}`);
        const historial = await response.json();
        
        let content = '<div class="table-responsive"><table class="table table-striped">';
        content += '<thead><tr><th>Fecha</th><th>Tipo</th><th>Códigos</th><th>Estado</th><th>Observaciones</th></tr></thead><tbody>';
        
        historial.reparaciones.forEach(rep => {
            content += `
                <tr>
                    <td>${new Date(rep.fechaCreacion).toLocaleDateString()}</td>
                    <td>${rep.tipo}</td>
                    <td>${rep.codigos.join(', ')}</td>
                    <td><span class="badge bg-${rep.estado === 'COMPLETADA' ? 'success' : 'warning'}">${rep.estado}</span></td>
                    <td>${rep.observaciones || '-'}</td>
                </tr>
            `;
        });
        
        content += '</tbody></table></div>';
        
        document.getElementById('historial-content').innerHTML = content;
        new bootstrap.Modal(document.getElementById('modalHistorial')).show();
    } catch (error) {
        Swal.fire('Error', 'Error al cargar historial', 'error');
    }
}
</script>
```

### 2. Vista de Reparación (URep)

#### Archivo: `views/formato_reparacion/[SKU].ejs`

Agregar la sección de reparaciones:

```html
<!-- Sección de Reparaciones -->
<div class="card mt-4">
    <div class="card-header bg-danger text-white">
        <h5 class="mb-0">🔧 Sistema de Reparaciones</h5>
    </div>
    <div class="card-body">
        <!-- Equipos Pendientes -->
        <div class="mb-4">
            <h6 class="fw-bold">📋 Equipos Pendientes de Reparación</h6>
            <div id="equipos-pendientes" class="list-group">
                <!-- Se llenarán dinámicamente -->
            </div>
        </div>
        
        <!-- Formulario de Reparación -->
        <div id="seccion-reparacion" style="display: none;">
            <h6 class="fw-bold">🛠️ Completar Reparación</h6>
            <form id="form-reparacion">
                <input type="hidden" id="reparacion-id" name="reparacionId">
                
                <div class="row">
                    <div class="col-md-6">
                        <div class="mb-3">
                            <label class="form-label fw-bold">S/N del Equipo:</label>
                            <input type="text" class="form-control" id="sn-reparacion" readonly>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="mb-3">
                            <label class="form-label fw-bold">Códigos de Daño Detectados:</label>
                            <div id="danos-detectados" class="form-control" style="min-height: 38px; background-color: #f8f9fa;">
                                <!-- Códigos de daño -->
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Códigos de Reparación -->
                <div class="mb-3">
                    <label class="form-label fw-bold">Códigos de Reparación Aplicados:</label>
                    <div class="row" id="codigos-reparacion-container">
                        <!-- Se llenarán dinámicamente -->
                    </div>
                </div>
                
                <!-- Estado de la Reparación -->
                <div class="mb-3">
                    <label class="form-label fw-bold">Estado de la Reparación:</label>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="exitosa" id="reparacion-exitosa" value="true" checked>
                        <label class="form-check-label text-success fw-bold" for="reparacion-exitosa">
                            ✅ Reparación Exitosa
                        </label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="radio" name="exitosa" id="reparacion-fallida" value="false">
                        <label class="form-check-label text-danger fw-bold" for="reparacion-fallida">
                            ❌ No Reparable / Scrap
                        </label>
                    </div>
                </div>
                
                <!-- Observaciones -->
                <div class="mb-3">
                    <label for="observaciones-reparacion" class="form-label">Observaciones de Reparación:</label>
                    <textarea class="form-control" id="observaciones-reparacion" name="observaciones" rows="3" 
                              placeholder="Describe el trabajo realizado..."></textarea>
                </div>
                
                <div class="d-grid gap-2">
                    <button type="submit" class="btn btn-success btn-lg">
                        ✅ Completar Reparación
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="cancelarReparacion()">
                        Cancelar
                    </button>
                </div>
            </form>
        </div>
    </div>
</div>
```

#### JavaScript para Reparación

```html
<script>
let codigosReparacionDisponibles = [];
let equiposPendientes = [];

document.addEventListener('DOMContentLoaded', function() {
    cargarCodigosReparacion();
    cargarEquiposPendientes();
});

async function cargarCodigosReparacion() {
    try {
        const response = await fetch('/api/reparacion/codigos-reparacion');
        codigosReparacionDisponibles = await response.json();
        renderizarCodigosReparacion();
    } catch (error) {
        console.error('Error cargando códigos de reparación:', error);
    }
}

function renderizarCodigosReparacion() {
    const container = document.getElementById('codigos-reparacion-container');
    container.innerHTML = '';
    
    const nivel1 = codigosReparacionDisponibles.filter(c => c.nivel === 'NIVEL_1');
    const nivel2 = codigosReparacionDisponibles.filter(c => c.nivel === 'NIVEL_2');
    
    // Nivel 1
    if (nivel1.length > 0) {
        const divNivel1 = document.createElement('div');
        divNivel1.className = 'col-12 mb-3';
        divNivel1.innerHTML = '<h6 class="text-primary">🔧 Nivel 1 - Reparaciones Básicas</h6>';
        container.appendChild(divNivel1);
        
        nivel1.forEach(codigo => {
            if (codigo.activo) {
                const div = document.createElement('div');
                div.className = 'col-md-6 mb-2';
                div.innerHTML = `
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" 
                               id="rep-${codigo.codigo}" name="codigosReparacion" value="${codigo.codigo}">
                        <label class="form-check-label small" for="rep-${codigo.codigo}">
                            <strong>${codigo.codigo}</strong>: ${codigo.descripcion}
                        </label>
                    </div>
                `;
                container.appendChild(div);
            }
        });
    }
    
    // Nivel 2
    if (nivel2.length > 0) {
        const divNivel2 = document.createElement('div');
        divNivel2.className = 'col-12 mb-3 mt-3';
        divNivel2.innerHTML = '<h6 class="text-warning">⚡ Nivel 2 - Soldadura y Componentes</h6>';
        container.appendChild(divNivel2);
        
        nivel2.forEach(codigo => {
            if (codigo.activo) {
                const div = document.createElement('div');
                div.className = 'col-md-6 mb-2';
                div.innerHTML = `
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" 
                               id="rep-${codigo.codigo}" name="codigosReparacion" value="${codigo.codigo}">
                        <label class="form-check-label small" for="rep-${codigo.codigo}">
                            <strong>${codigo.codigo}</strong>: ${codigo.descripcion}
                        </label>
                    </div>
                `;
                container.appendChild(div);
            }
        });
    }
}

async function cargarEquiposPendientes() {
    try {
        const response = await fetch('/api/reparacion/pendientes');
        equiposPendientes = await response.json();
        renderizarEquiposPendientes();
    } catch (error) {
        console.error('Error cargando equipos pendientes:', error);
    }
}

function renderizarEquiposPendientes() {
    const container = document.getElementById('equipos-pendientes');
    container.innerHTML = '';
    
    if (equiposPendientes.length === 0) {
        container.innerHTML = '<div class="alert alert-info">📋 No hay equipos pendientes de reparación</div>';
        return;
    }
    
    equiposPendientes.forEach(equipo => {
        const item = document.createElement('div');
        item.className = 'list-group-item list-group-item-action';
        item.innerHTML = `
            <div class="d-flex w-100 justify-content-between">
                <h6 class="mb-1">🔧 ${equipo.sn}</h6>
                <small>${new Date(equipo.fechaCreacion).toLocaleDateString()}</small>
            </div>
            <p class="mb-1"><strong>Códigos de Daño:</strong> ${equipo.codigosDano.join(', ')}</p>
            <small>${equipo.observaciones || 'Sin observaciones'}</small>
            <div class="mt-2">
                <button class="btn btn-primary btn-sm" onclick="iniciarReparacion(${equipo.id}, '${equipo.sn}', '${equipo.codigosDano.join(', ')}')">
                    🛠️ Iniciar Reparación
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

function iniciarReparacion(reparacionId, sn, codigosDano) {
    document.getElementById('reparacion-id').value = reparacionId;
    document.getElementById('sn-reparacion').value = sn;
    document.getElementById('danos-detectados').innerHTML = codigosDano;
    document.getElementById('seccion-reparacion').style.display = 'block';
    document.getElementById('seccion-reparacion').scrollIntoView({ behavior: 'smooth' });
}

function cancelarReparacion() {
    document.getElementById('seccion-reparacion').style.display = 'none';
    document.getElementById('form-reparacion').reset();
}

// Manejar envío del formulario de reparación
document.getElementById('form-reparacion').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = new FormData(this);
    const codigosReparacion = Array.from(document.querySelectorAll('input[name="codigosReparacion"]:checked'))
                                   .map(cb => cb.value);
    
    if (codigosReparacion.length === 0) {
        Swal.fire('Error', 'Selecciona al menos un código de reparación', 'error');
        return;
    }
    
    const data = {
        reparacionId: parseInt(formData.get('reparacionId')),
        codigosReparacion: codigosReparacion,
        exitosa: formData.get('exitosa') === 'true',
        observaciones: formData.get('observaciones')
    };
    
    try {
        const response = await fetch('/api/reparacion/completar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            Swal.fire('Éxito', 'Reparación completada correctamente', 'success');
            cancelarReparacion();
            cargarEquiposPendientes(); // Recargar lista
        } else {
            Swal.fire('Error', result.error || 'Error al completar reparación', 'error');
        }
    } catch (error) {
        Swal.fire('Error', 'Error de conexión', 'error');
        console.error('Error:', error);
    }
});
</script>
```

## Códigos de Referencia

### Códigos de Daño (CodigoDano)

| Código | Descripción | Activo |
|--------|-------------|--------|
| D000 | Sin daño aparente | ✅ |
| D001 | Daño en carcasa | ✅ |
| D002 | Daño en conectores | ✅ |
| D003 | Daño en pantalla/display | ✅ |
| D004 | Daño en botones | ✅ |
| D005 | Daño en antena | ✅ |
| D006 | Daño en fuente de poder | ✅ |
| D007 | Daño en LED indicadores | ✅ |
| D008 | Daño en ventilación | ✅ |
| D009 | Daño en etiquetas | ✅ |
| D010 | Daño por humedad | ✅ |
| D011 | Daño por sobrecalentamiento | ✅ |
| D012 | Daño en circuito impreso | ✅ |
| D013 | Daño en capacitores | ✅ |
| D014 | Daño en resistencias | ✅ |
| D015 | Daño en transistores | ✅ |
| D016 | Daño en conectores internos | ✅ |
| D017 | Daño en memoria | ✅ |
| D018 | Daño en procesador | ✅ |
| D019 | Daño en firmware/software | ✅ |
| D020 | Daño por cortocircuito | ✅ |
| D021 | Daño por sobrevoltaje | ✅ |
| D022 | Daño en soldaduras | ✅ |
| D023 | Daño por corrosión | ✅ |
| D024 | Daño en chasis metálico | ✅ |
| D025 | Otros daños no especificados | ✅ |
| B001 | Bloque de daños múltiples | ✅ |
| B002 | Bloque de daños críticos | ✅ |

### Códigos de Reparación (CodigoReparacion)

#### Nivel 1 - Reparaciones Básicas

| Código | Descripción | Nivel |
|--------|-------------|-------|
| N001 | Limpieza general del equipo | NIVEL_1 |
| N002 | Reemplazo de carcasa | NIVEL_1 |
| N003 | Reemplazo de conectores externos | NIVEL_1 |
| N004 | Reemplazo de botones | NIVEL_1 |
| N005 | Reemplazo de antena | NIVEL_1 |
| N006 | Reemplazo de fuente de poder | NIVEL_1 |
| N007 | Reemplazo de LEDs | NIVEL_1 |
| N008 | Reparación de ventilación | NIVEL_1 |
| N009 | Reemplazo de etiquetas | NIVEL_1 |
| N010 | Secado por humedad | NIVEL_1 |
| N011 | Enfriamiento y ventilación | NIVEL_1 |
| N012 | Reemplazo de memoria | NIVEL_1 |
| N013 | Actualización de firmware | NIVEL_1 |
| N014 | Reconfiguración de software | NIVEL_1 |
| N015 | Pruebas de conectividad | NIVEL_1 |
| N016 | Calibración de parámetros | NIVEL_1 |

#### Nivel 2 - Soldadura y Componentes

| Código | Descripción | Nivel |
|--------|-------------|-------|
| SC1 | Soldadura de componentes básicos | NIVEL_2 |
| SC2 | Soldadura de conectores internos | NIVEL_2 |
| SC3 | Reparación de circuito impreso | NIVEL_2 |

## Flujo de Trabajo

### **REPARACION como Fase Secuencial Opcional**

La fase REPARACION se ha incorporado entre TEST_INICIAL y ENSAMBLE como una fase **opcional**:

📍 **Flujo Normal (sin reparación)**:
```
REGISTRO → TEST_INICIAL → ENSAMBLE → RETEST → EMPAQUE
```

📍 **Flujo con Reparación**:
```
REGISTRO → TEST_INICIAL → REPARACION → ENSAMBLE → RETEST → EMPAQUE
```

### **Compatibilidad con Triggers del Sistema**

✅ **El sistema de reparaciones es TOTALMENTE COMPATIBLE con los triggers actualizados**:

- **Orden de fases corregido**: REPARACION ahora está en posición 3 (entre TEST_INICIAL y ENSAMBLE)
- **`validar_transicion_modem`**: Actualizado con reglas especiales para REPARACION opcional
- **`validar_codigos_reparacion`**: Asigna automáticamente códigos de reparación
- **`auto_limpiar_registros`**: No afecta las reparaciones (ocurren antes del empaque)
- **`filtrar_logs`**: Los logs de reparación son considerados importantes

### **Transiciones Permitidas**

```
📍 Flujo Normal (REPARACION opcional):
REGISTRO(1) → TEST_INICIAL(2) → REPARACION(3) → ENSAMBLE(4) → RETEST(5) → EMPAQUE(6)

📍 Salto de REPARACION (fase opcional):
TEST_INICIAL(2) → ENSAMBLE(4) ✅ (saltar REPARACION)

📍 Regreso desde REPARACION:
REPARACION(3) → TEST_INICIAL(2) ✅ (para re-evaluación)

📍 Avance normal desde REPARACION:
REPARACION(3) → ENSAMBLE(4) ✅

📍 Casos especiales:
Cualquier fase → SCRAP ✅ (siempre permitido)
SCRAP → ENSAMBLE ✅ (recuperación)
RETEST → ENSAMBLE ✅ (transición especial existente)
```

### **Proceso Detallado**

1. **Test Inicial (UTI)**:
   - Escanea el equipo normalmente en fase TEST_INICIAL
   - Si detecta problemas, activa el modo diagnóstico
   - Selecciona códigos de daño apropiados
   - Si marca "requiere reparación":
     - El módem transiciona a fase REPARACION
     - Se crea un registro en la tabla Reparacion con estado PENDIENTE
   - Si no requiere reparación:
     - El módem avanza directamente a ENSAMBLE (saltando REPARACION)

2. **Reparación (URep)**:
   - Ve la lista de equipos pendientes en fase REPARACION
   - Selecciona un equipo para reparar
   - Aplica las reparaciones necesarias
   - Registra los códigos de reparación utilizados
   - Opciones al completar:
     - **Reparación exitosa**: el módem avanza a ENSAMBLE
     - **Requiere re-evaluación**: el módem regresa a TEST_INICIAL
     - **No reparable**: el módem se marca como SCRAP

### **Gestión y Captura de Datos**

- **REPARACION tiene su propio formato** y selección de SKU (igual que EMPAQUE y REGISTRO)
- **Los códigos de reparación** (N001-N016, SC1-SC3) están disponibles al registrar
- **Los casos asociados** a cada código quedan registrados
- **Datos visibles en historial** hasta la fase de empaque
- **Trigger automático** asigna códigos según el tipo de daño detectado

## Instalación y Configuración

1. **Base de Datos**: Las migraciones ya están aplicadas
2. **API**: Los endpoints están configurados en `apiRoutes.js`
3. **Frontend**: Implementar las secciones HTML y JavaScript mostradas arriba
4. **Permisos**: UTI y URep tienen acceso a las funciones correspondientes

## Notas Importantes

- Los códigos están estandarizados y no deben modificarse sin coordinación
- El sistema mantiene un historial completo de todas las reparaciones
- Los equipos no reparables se marcan automáticamente para scrap
- Los usuarios deben tener los roles correctos para acceder a cada función
