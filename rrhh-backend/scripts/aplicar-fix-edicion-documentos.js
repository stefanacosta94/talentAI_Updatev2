/**
 * Fase 4B.4: agrega únicamente la ruta PUT /documentos/:id cuando falta.
 * No reemplaza el resto de admin.routes.js ni cambia endpoints existentes.
 * Requiere el backend de Phase 2.3+ (storage privado y auditService).
 * Ejecución desde rrhh-backend: node scripts/aplicar-fix-edicion-documentos.js
 */
const fs = require('node:fs');
const path = require('node:path');
const routeFile = path.resolve(__dirname, '../src/routes/admin.routes.js');
const backupFile = routeFile + '.fase4b4.bak';
const route = "// Edición de título y, opcionalmente, reemplazo seguro de PDF en Storage privado.\nrouter.put('/documentos/:id', upload.single('archivo_documento'), async (req, res, next) => {\n  let nuevaRuta = null;\n  try {\n    const id = Number(req.params.id);\n    const titulo = String(req.body.titulo || '').trim();\n    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ exito: false, error: 'ID de documento inválido.' });\n    if (!titulo || titulo.length > 180) return res.status(400).json({ exito: false, error: 'El título debe tener entre 1 y 180 caracteres.' });\n    const { data: anterior, error: findError } = await supabase.from('base_conocimiento')\n      .select('id_documento, url_archivo').eq('id_documento', id).maybeSingle();\n    if (findError) throw createSupabaseError(findError, 'No fue posible localizar el documento');\n    if (!anterior) return res.status(404).json({ exito: false, error: 'Documento no encontrado.' });\n\n    const cambios = { titulo };\n    if (req.file) {\n      const validacion = validatePdfFile(req.file);\n      if (!validacion.ok) return res.status(400).json({ exito: false, error: validacion.error });\n      cambios.contenido_texto = await atsService.extraerTextoPDF(req.file.buffer);\n      const nombre = `doc_${Date.now()}_${safeFileComponent(req.file.originalname, 'documento.pdf')}`;\n      nuevaRuta = await uploadPrivatePdf('documentos_empresa', nombre, req.file.buffer);\n      cambios.url_archivo = nuevaRuta;\n    }\n\n    const { data, error } = await supabase.from('base_conocimiento')\n      .update(cambios).eq('id_documento', id).select('id_documento, titulo').maybeSingle();\n    if (error) throw createSupabaseError(error, 'No fue posible actualizar el documento');\n    if (!data) {\n      if (nuevaRuta) await removeStoredObject('documentos_empresa', nuevaRuta).catch(() => {});\n      return res.status(404).json({ exito: false, error: 'Documento no encontrado.' });\n    }\n    // Compensación: el archivo antiguo se retira solo después de persistir la nueva referencia.\n    // Si falla la limpieza, la BD sigue consistente y un proceso posterior puede depurar el huérfano.\n    if (nuevaRuta && anterior.url_archivo && anterior.url_archivo !== nuevaRuta) {\n      try { await removeStoredObject('documentos_empresa', anterior.url_archivo); }\n      catch (storageError) { console.warn('No fue posible limpiar el PDF anterior:', storageError?.message); }\n    }\n    nuevaRuta = null;\n    await registrarAuditoria(req.usuario.id, 'Actualización de Documento', 'Base de Conocimiento', `Documento ${id} actualizado`);\n    res.json({ exito: true, documento: data });\n  } catch (error) {\n    if (nuevaRuta) await removeStoredObject('documentos_empresa', nuevaRuta).catch(() => {});\n    next(error);\n  }\n});\n\n";

const source = fs.readFileSync(routeFile, 'utf8');
if (/router\.put\s*\(\s*['"]\/documentos\/:id['"]/.test(source)) {
  console.log('✅ La ruta PUT /documentos/:id ya existe. No se alteró el archivo.');
  console.log('Si ves 404, verifica qué proceso/archivo de backend está corriendo en el puerto 3000 y reinícialo.');
  process.exit(0);
}
const anchor = "router.get('/documentos/:id/url'";
if (!source.includes(anchor)) {
  console.error('❌ Versión de admin.routes.js distinta. No se aplicó ningún cambio.');
  process.exitCode = 1;
} else {
  const dependencies = ['uploadPrivatePdf', 'removeStoredObject', 'validatePdfFile', 'safeFileComponent', 'registrarAuditoria'];
  const missing = dependencies.filter(name => !source.includes(name));
  if (missing.length) {
    console.error(`❌ Faltan dependencias en admin.routes.js: ${missing.join(', ')}`);
    process.exitCode = 1;
  } else if (fs.existsSync(backupFile)) {
    console.error(`❌ Ya existe un respaldo en ${backupFile}; muévelo si deseas volver a aplicar el parche.`);
    process.exitCode = 1;
  } else {
    fs.copyFileSync(routeFile, backupFile, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(routeFile, source.replace(anchor, route + anchor), 'utf8');
    console.log('✅ Endpoint PUT /api/admin/documentos/:id incorporado.');
    console.log(`Respaldo local: ${backupFile}`);
    console.log('Reinicia el servidor Express desde rrhh-backend con npm start.');
  }
}
