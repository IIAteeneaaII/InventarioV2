/**
 * Middleware para garantizar que los datos de usuario estén disponibles en todas las vistas
 */
module.exports = (req, res, next) => {
  // Asegurar que res.locals.user siempre exista para las plantillas EJS
  res.locals.user = req.user || { 
    id: null, 
    rol: '', 
    nombre: '', 
    userName: '', 
    email: '' 
  };
  next();
};