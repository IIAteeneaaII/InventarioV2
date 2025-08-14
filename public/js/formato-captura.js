document.addEventListener('DOMContentLoaded', () => {
  const guardarBtn = document.getElementById('guardar-btn');
  const finalizarLoteBtn = document.getElementById('finalizar-lote-btn');
  const snInput = document.getElementById('sn-input');
  const scrapInput = document.getElementById('scrap-input');
  const motivoScrapSelect = document.getElementById('motivo-scrap');
  const skuTitle = document.querySelector('.form-section h1');
  
  // Usar el indicador de estado que ya existe en el HTML
  const statusIndicator = document.querySelector('.status-indicator');

if (scrapInput && motivoScrapSelect) {
  motivoScrapSelect.addEventListener('change', () => {
    const motivo = motivoScrapSelect.value.trim();
    if (motivo !== '') {
      scrapInput.value = `SCRAP-${motivo}`;
    } else {
      scrapInput.value = '';
    }
  });
}

  
  // Extraer el SKU directamente del título H1 que ya existe
  const skuText = skuTitle ? skuTitle.textContent.trim() : '';
  const skuMatch = skuText.match(/\d{5,6}$/); // Buscar 5-6 dígitos al final del texto
  const sku = skuMatch ? skuMatch[0] : '';

  if (!sku) {
    console.error('No se pudo detectar el SKU del título:', skuText);
    return;
  }
  
  console.log(`SKU detectado: ${sku}`);
  
  // Obtener info del usuario del objeto global que proporciona el middleware
  const userInfo = document.querySelector('.username');
  const userName = userInfo ? userInfo.textContent.trim() : '';
  
  // Crear clave única para este SKU y usuario
  const sessionKey = `scan_session_${sku}_${userName}_${new Date().toISOString().split('T')[0]}`;
  
  // Limpiar datos de otros SKUs
  limpiarOtrosSKUs(sessionKey);
  
  // Agregar indicador de SKU actual
  const skuIndicator = document.createElement('div');
  skuIndicator.className = 'sku-indicator';
  skuIndicator.textContent = `SKU: ${sku}`;
  document.querySelector('.form-section').appendChild(skuIndicator);

  // Contador de escaneos - con persistencia local solo para este SKU
  let scanCounter = parseInt(localStorage.getItem(`${sessionKey}_count`) || '0');
  let scanCountDisplay = document.createElement('div');
  scanCountDisplay.className = 'scan-counter';
  scanCountDisplay.textContent = `Escaneos (${sku}): ${scanCounter}`;
  if (guardarBtn && guardarBtn.parentNode) {
    guardarBtn.parentNode.appendChild(scanCountDisplay);
  }

  // Verificar que existan los elementos necesarios
  if (!guardarBtn || !snInput || !statusIndicator) return;
  
  // Convertir a mayúsculas automáticamente
  snInput.addEventListener('input', function() {
    this.value = this.value.toUpperCase();
  });
  
  if (scrapInput) {
    scrapInput.addEventListener('input', function() {
      this.value = this.value.toUpperCase();
    });
  }

  // Variables para manejar el lote activo
  let loteActivo = localStorage.getItem(`${sessionKey}_loteId`) || null;
  if (loteActivo && finalizarLoteBtn) {
    finalizarLoteBtn.style.display = 'block';
  }
  
  // Lista para guardar los SN escaneados - específica para este SKU
  const scannedItems = JSON.parse(localStorage.getItem(`${sessionKey}_items`) || '[]');
  
  // IMPORTANTE: Cargar datos iniciales filtrados por SKU
  cargarDatosIniciales(sku);
  
  // Función para limpiar datos de otros SKUs
  function limpiarOtrosSKUs(currentKey) {
    // Obtener todas las claves en localStorage
    const keysToKeep = [];
    Object.keys(localStorage).forEach(key => {
      // Si es una clave de sesión pero no del SKU actual, eliminar
      if (key.startsWith('scan_session_') && !key.startsWith(currentKey)) {
        localStorage.removeItem(key);
      } else if (key.startsWith(currentKey)) {
        keysToKeep.push(key);
      }
    });
    console.log('Claves mantenidas:', keysToKeep);
  }
  
  // Función para cargar datos iniciales filtrados por SKU
  async function cargarDatosIniciales(sku) {
    try {
      const tablaBody = document.getElementById('registros-body');
      if (!tablaBody) {
        console.error('No se encontró la tabla de registros');
        return;
      }
      
      // Limpiar completamente la tabla existente
      tablaBody.innerHTML = '';
      
      statusIndicator.innerHTML = '<span class="processing">Cargando datos...</span>';
      
      // Obtener datos iniciales del servidor, filtrados por SKU
      const response = await fetch(`/api/registros/sku/${sku}`, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin'
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.registros && data.registros.length > 0) {
          // Mostrar los registros en la tabla
          data.registros.forEach(registro => {
            const nuevaFila = document.createElement('tr');
            nuevaFila.innerHTML = `
              <td>${registro.user?.nombre || 'Usuario'}</td>
              <td>${registro.sn || registro.modem?.sn || 'N/A'}</td>
              <td>${new Date(registro.createdAt).toLocaleString('es-MX')}</td>
              <td>${registro.estado || 'N/A'}</td>
              <td>${registro.motivoScrap || 'N/A'}</td>
            `;
            
            if (registro.estado && registro.estado.includes('SCRAP')) {
              nuevaFila.classList.add('fila-scrap');
            }
            
            tablaBody.appendChild(nuevaFila);
          });
          
          console.log(`Cargados ${data.registros.length} registros para SKU ${sku}`);
        } else {
          console.log(`No hay registros para el SKU ${sku}`);
        }
        
        statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
      } else {
        console.error('Error al cargar datos iniciales:', await response.text());
        statusIndicator.innerHTML = '<span class="error">Error al cargar datos</span>';
        
        setTimeout(() => {
          statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
        }, 2000);
      }
    } catch (error) {
      console.error('Error de red al cargar datos iniciales:', error);
      statusIndicator.innerHTML = '<span class="error">Error de conexión</span>';
      
      setTimeout(() => {
        statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
      }, 2000);
    }
  }
  
  
  // Función para actualizar la tabla con animación mínima
  function actualizarTablaOptimizada(data) {
      const tablaBody = document.getElementById('registros-body');
      if (!tablaBody) return;
      
      const nuevaFila = document.createElement('tr');
      
      // Determinar si es scrap y aplicar clase CSS correspondiente
      const esScrap = data.scrap && data.scrap.includes('SCRAP');
      if (esScrap) {
          nuevaFila.classList.add('fila-scrap');
      }
      
      // Formatear el motivo scrap para mostrarlo (removiendo "SCRAP-" si existe)
      const motivoMostrado = data.motivoScrap 
          ? data.motivoScrap.replace('SCRAP-', '').replace(/_/g, ' ')
          : 'N/A';
      
      nuevaFila.innerHTML = `
        <td>${data.userName || userName}</td>
        <td>${data.sn}</td>
        <td>${new Date().toLocaleString('es-MX')}</td>
        <td>${esScrap ? 'SCRAP' : 'SN_OK'}</td>
        <td>${motivoMostrado}</td>
      `;
      
      // Insertar al inicio sin animación
      if (tablaBody.firstChild) {
          tablaBody.insertBefore(nuevaFila, tablaBody.firstChild);
      } else {
          tablaBody.appendChild(nuevaFila);
      }
      
      // Mantener la tabla con un máximo de filas para evitar lentitud
      const maxRows = 20;
      while (tablaBody.children.length > maxRows) {
          tablaBody.removeChild(tablaBody.lastChild);
      }
  }

  // Función para guardar el registro optimizada para velocidad
  const guardarRegistro = async () => {
    const sn = snInput.value.toUpperCase().trim();
    
    if (!sn) {
      statusIndicator.innerHTML = '<span class="error">S/N vacío</span>';
      setTimeout(() => {
        statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
      }, 1000);
      return;
    }
    
    // Evitar duplicados inmediatos
    if (scannedItems.includes(sn)) {
      statusIndicator.innerHTML = '<span class="warning">S/N duplicado</span>';
      snInput.value = '';
      snInput.focus();
      setTimeout(() => {
        statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
      }, 1000);
      return;
    }
    
    // Agregar a la lista de escaneados
    scannedItems.push(sn);
    if (scannedItems.length > 100) scannedItems.shift(); // Mantener la lista manejable
    localStorage.setItem(`${sessionKey}_items`, JSON.stringify(scannedItems));
    
    const scrap = scrapInput ? scrapInput.value.toUpperCase() : '';
    const motivoScrap = motivoScrapSelect ? motivoScrapSelect.value : '';

    // Cambiar estado visual mientras se procesa
    statusIndicator.innerHTML = '<span class="processing">Procesando...</span>';
    
    try {
      const response = await fetch('/api/registros', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ sn, scrap, motivoScrap, sku }),
      });

      // Manejar respuesta
      if (response.ok) {
        const data = await response.json();
        
        // Incrementar contador y guardar en localStorage para este SKU
        scanCounter++;
        localStorage.setItem(`${sessionKey}_count`, scanCounter.toString());
        scanCountDisplay.textContent = `Escaneos (${sku}): ${scanCounter}`;
        
        // Guardar referencia al lote para finalización
        if (data.loteId) {
          loteActivo = data.loteId;
          localStorage.setItem(`${sessionKey}_loteId`, loteActivo);
          
          if (finalizarLoteBtn) {
            finalizarLoteBtn.style.display = 'block';
          }
        }

        // Actualizar tabla sin animaciones
        actualizarTablaOptimizada({
            sn,
            scrap,
            motivoScrap,
            userName: data.userName || userName
        });
        
        // Mostrar brevemente estado exitoso
        statusIndicator.innerHTML = '<span class="success">✓</span>';
        setTimeout(() => {
          statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
        }, 500);
        
        // Limpiar campos y dar foco para siguiente escaneo
        snInput.value = '';
        if (scrapInput) scrapInput.value = '';
        if (motivoScrapSelect) motivoScrapSelect.value = '';
      } else {
        // Manejar error
        const errorData = await response.json();
        statusIndicator.innerHTML = `<span class="error">${errorData.error || 'Error'}</span>`;
        console.error('Error en registro:', errorData);
        
        setTimeout(() => {
          statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
        }, 2000);
      }
    } catch (error) {
      statusIndicator.innerHTML = `<span class="error">Error de red</span>`;
      console.error('Error de red:', error);
      
      setTimeout(() => {
        statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
      }, 2000);
    }
    
    // Siempre enfocar el campo para el siguiente escaneo
    snInput.focus();
  };

  // Finalizar lote con confirmación mínima
  const finalizarLote = async () => {
    if (!loteActivo) {
      statusIndicator.innerHTML = '<span class="warning">No hay lote activo</span>';
      setTimeout(() => {
        statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
      }, 2000);
      return;
    }

    if (!confirm('¿Finalizar el lote actual?')) return;

    statusIndicator.innerHTML = '<span class="processing">Finalizando lote...</span>';
    
    try {
      const response = await fetch('/api/lotes/finalizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ loteId: loteActivo }),
      });

      if (response.ok) {
        statusIndicator.innerHTML = '<span class="success">Lote finalizado</span>';
        
        // Limpiar localStorage para este SKU
        localStorage.removeItem(`${sessionKey}_loteId`);
        localStorage.removeItem(`${sessionKey}_count`);
        localStorage.removeItem(`${sessionKey}_items`);
        
        // Reiniciar contador
        scanCounter = 0;
        scanCountDisplay.textContent = `Escaneos (${sku}): ${scanCounter}`;
        
        if (finalizarLoteBtn) {
          finalizarLoteBtn.style.display = 'none';
        }
        
        loteActivo = null;
        
        setTimeout(() => {
          statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
        }, 2000);
      } else {
        const errorData = await response.json();
        statusIndicator.innerHTML = `<span class="error">${errorData.error || 'Error al finalizar'}</span>`;
        
        setTimeout(() => {
          statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
        }, 2000);
      }
    } catch (error) {
      statusIndicator.innerHTML = '<span class="error">Error de red</span>';
      console.error('Error:', error);
      
      setTimeout(() => {
        statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
      }, 2000);
    }
  };

  // Ping de sesión cada 3 minutos
  setInterval(() => {
    fetch('/api/test', { 
      method: 'GET',
      credentials: 'same-origin'
    }).catch(err => console.error('Error en ping de sesión:', err));
  }, 3 * 60 * 1000);

  // Eventos
  guardarBtn.addEventListener('click', guardarRegistro);
  
  if (finalizarLoteBtn) {
    finalizarLoteBtn.addEventListener('click', finalizarLote);
    if (!loteActivo) {
      finalizarLoteBtn.style.display = 'none';
    }
  }

  // 1. Añadir variable para controlar el estado del Auto-Enter
  let autoEnterEnabled = true; // Por defecto activado
  
  // 2. Obtener referencia al botón de toggle
  const autoEnterToggle = document.getElementById('autoenter-toggle');
  
  // 3. Función para actualizar el estado y apariencia del botón
  const updateAutoEnterButton = () => {
    if (autoEnterToggle) {
      if (autoEnterEnabled) {
        autoEnterToggle.classList.add('autoenter-off');
        autoEnterToggle.classList.remove('autoenter-on');
        autoEnterToggle.innerHTML = '<i class="fas fa-keyboard"></i> SCRAP: OFF';
        autoEnterToggle.title = 'SCRAP desactivado (clic para activar)';
      } else {
        autoEnterToggle.classList.add('autoenter-on');
        autoEnterToggle.classList.remove('autoenter-off');
        autoEnterToggle.innerHTML = '<i class="fas fa-keyboard"></i> SCRAP: ON';
        autoEnterToggle.title = 'SCRAP activado (clic para desactivar)';
      }
    }
  };
  
  // 4. Event listener para el botón de toggle
  if (autoEnterToggle) {
    autoEnterToggle.addEventListener('click', (e) => {
      e.preventDefault();
      autoEnterEnabled = !autoEnterEnabled;
      updateAutoEnterButton();
      
      // Mostrar feedback visual del cambio
      statusIndicator.innerHTML = autoEnterEnabled 
        ? '<span class="warning">SCRAP DESACTIVADO</span>' 
        : '<span class="success">SCRAP ACTIVADO</span>';
      
      setTimeout(() => {
        statusIndicator.innerHTML = '<span class="ready">Listo para escanear</span>';
      }, 1500);
    });
    
    // Inicializar el botón
    updateAutoEnterButton();
  }

  // ... (resto del código existente)

  // 5. Modificar el event listener del Enter para considerar el estado del Auto-Enter
  snInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      
      // Si el Auto-Enter está desactivado, solo enfocar el motivo scrap si está vacío
      if (!autoEnterEnabled) {
        const motivo = motivoScrapSelect ? motivoScrapSelect.value.trim() : '';
        
        if (motivo === '' && scrapInput && scrapInput.value.trim() === '') {
          // Si no hay motivo scrap seleccionado, enfocar el select
          if (motivoScrapSelect) {
            motivoScrapSelect.focus();
            statusIndicator.innerHTML = '<span class="warning">Seleccione motivo scrap</span>';
          }
          return;
        }
      }
      
      // Si Auto-Enter está activado o ya hay motivo scrap, guardar
      guardarRegistro();
    }
  });

  
  // Enfoque inicial
  snInput.focus();
});