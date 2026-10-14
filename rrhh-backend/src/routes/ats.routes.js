const express = require('express');
const multer = require('multer');
const router = express.Router();
const supabase = require('../config/supabase');
const verificarToken = require('../middlewares/authMiddleware');
const atsService = require('../services/atsService');
const { uploadPrivatePdf, createSignedUrl, removeStoredObject } = require('../services/storageService');
const { validatePdfFile, safeFileComponent } = require('../security/securityUtils');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.post('/evaluar', verificarToken, upload.single('archivo_cv'), async (req, res, next) => {
  let storagePathCV = null;

  try {
    const validacionPDF = validatePdfFile(req.file);
    if (!validacionPDF.ok) return res.status(400).json({ exito: false, error: validacionPDF.error });

    const descripcionVacante = String(req.body.descripcion_vacante || '').trim();
    const idVacante = Number(req.body.id_vacante);
    const idCandidato = Number(req.body.id_candidato);

    if (!descripcionVacante) return res.status(400).json({ exito: false, error: 'Falta la descripción de la vacante.' });
    if (descripcionVacante.length > 12000) return res.status(400).json({ exito: false, error: 'La descripción de la vacante excede la longitud permitida.' });
    if (!Number.isInteger(idVacante) || idVacante <= 0 || !Number.isInteger(idCandidato) || idCandidato <= 0) {
      return res.status(400).json({ exito: false, error: 'id_vacante e id_candidato son obligatorios y deben ser válidos.' });
    }

    const { data: existente, error: errorExistente } = await supabase
      .from('aplicaciones_ats')
      .select('id_aplicacion')
      .eq('id_candidato', idCandidato)
      .eq('id_vacante', idVacante)
      .maybeSingle();

    if (errorExistente) throw new Error(errorExistente.message);
    if (existente) {
      return res.status(409).json({ exito: false, error: 'El candidato ya posee una aplicación para esta vacante.' });
    }

    const textoCV = await atsService.extraerTextoPDF(req.file.buffer);
    const evaluacion = await atsService.evaluarCandidato(textoCV, descripcionVacante);
    const nombreUnico = `cv_${Date.now()}_${safeFileComponent(req.file.originalname, 'curriculum.pdf')}`;
    storagePathCV = await uploadPrivatePdf('curriculums', nombreUnico, req.file.buffer);

    const { data: aplicacionGuardada, error: dbError } = await supabase
      .from('aplicaciones_ats')
      .insert([{
        id_candidato: idCandidato,
        id_vacante: idVacante,
        url_archivo_cv: storagePathCV,
        ai_match_score: evaluacion.ai_match_score,
        ai_resumen_habilidades: evaluacion.ai_resumen_habilidades,
        estado_proceso: 'Recibida',
      }])
      .select('id_aplicacion, ai_match_score, ai_resumen_habilidades, estado_proceso, url_archivo_cv')
      .single();

    if (dbError) {
      if (dbError.code === '23505') {
        await removeStoredObject('curriculums', storagePathCV).catch(() => {});
        storagePathCV = null;
        return res.status(409).json({ exito: false, error: 'El candidato ya posee una aplicación para esta vacante.' });
      }
      throw new Error(`Error al guardar en BD: ${dbError.message}`);
    }

    const signedUrl = await createSignedUrl('curriculums', storagePathCV);
    storagePathCV = null;
    aplicacionGuardada.url_archivo_cv = signedUrl;

    return res.json({
      exito: true,
      mensaje: 'Análisis completado y CV respaldado en la nube.',
      url_documento_nube: signedUrl,
      datos_analisis: evaluacion,
      aplicacion: aplicacionGuardada,
    });
  } catch (error) {
    if (storagePathCV) {
      await removeStoredObject('curriculums', storagePathCV).catch(() => {});
    }
    next(error);
  }
});
module.exports = router;
