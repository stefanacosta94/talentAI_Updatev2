const express = require('express');
const multer = require('multer');
const router = express.Router();
const supabase = require('../config/supabase');
const atsService = require('../services/atsService');
const { uploadPrivatePdf, removeStoredObject } = require('../services/storageService');
const {
  normalizeEmail,
  isValidEmail,
  validatePdfFile,
  safeFileComponent,
} = require('../security/securityUtils');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.get('/vacantes', async (req, res, next) => {
  try {
    const { data: vacantes, error } = await supabase
      .from('vacantes')
      .select('id_vacante, titulo, descripcion_puesto, requisitos, estado, fecha_creacion, departamentos (nombre)')
      .eq('estado', 'Activa');
    if (error) throw new Error(error.message);
    res.json({ exito: true, total: vacantes.length, vacantes });
  } catch (error) { next(error); }
});

router.post('/aplicar', upload.single('archivo_cv'), async (req, res, next) => {
  let storagePathCV = null;

  try {
    const idVacante = Number(req.body.id_vacante);
    const nombre = String(req.body.nombre || '').trim();
    const correo = normalizeEmail(req.body.correo);
    const telefono = String(req.body.telefono || '').trim();
    const linkedin = String(req.body.linkedin || '').trim();
    const archivo = req.file;

    if (!Number.isInteger(idVacante) || idVacante <= 0) {
      return res.status(400).json({ exito: false, error: 'La vacante indicada no es válida.' });
    }
    if (!nombre || nombre.length > 120) {
      return res.status(400).json({ exito: false, error: 'El nombre es obligatorio y debe tener máximo 120 caracteres.' });
    }
    if (!isValidEmail(correo)) {
      return res.status(400).json({ exito: false, error: 'El correo electrónico no tiene un formato válido.' });
    }
    if (telefono.length > 40 || linkedin.length > 300) {
      return res.status(400).json({ exito: false, error: 'Teléfono o enlace de LinkedIn exceden la longitud permitida.' });
    }

    const validacionPDF = validatePdfFile(archivo);
    if (!validacionPDF.ok) {
      return res.status(400).json({ exito: false, error: validacionPDF.error });
    }

    const { data: vacante, error: errorVacante } = await supabase
      .from('vacantes')
      .select('id_vacante, titulo, descripcion_puesto, requisitos, estado')
      .eq('id_vacante', idVacante)
      .maybeSingle();

    if (errorVacante) throw new Error(`No fue posible consultar la vacante: ${errorVacante.message}`);
    if (!vacante) {
      return res.status(404).json({ exito: false, error: 'No se encontró la vacante especificada.' });
    }
    if (vacante.estado !== 'Activa') {
      return res.status(409).json({ exito: false, error: 'La vacante ya no se encuentra activa.' });
    }

    const { data: candidatoExistente, error: errorConsultaCandidato } = await supabase
      .from('candidatos')
      .select('id_candidato')
      .eq('correo', correo)
      .maybeSingle();

    if (errorConsultaCandidato) {
      throw new Error(`No fue posible consultar el candidato: ${errorConsultaCandidato.message}`);
    }

    let idCandidatoReal = candidatoExistente?.id_candidato || null;

    if (idCandidatoReal) {
      const { data: aplicacionExistente, error: errorAplicacionExistente } = await supabase
        .from('aplicaciones_ats')
        .select('id_aplicacion')
        .eq('id_candidato', idCandidatoReal)
        .eq('id_vacante', idVacante)
        .maybeSingle();

      if (errorAplicacionExistente) {
        throw new Error(`No fue posible validar aplicaciones previas: ${errorAplicacionExistente.message}`);
      }

      if (aplicacionExistente) {
        return res.status(409).json({
          exito: false,
          error: 'Este candidato ya se postuló a esta vacante.',
        });
      }
    }

    const textoCV = await atsService.extraerTextoPDF(archivo.buffer);
    const descripcionCompleta = `Puesto: ${vacante.titulo}. Descripción: ${vacante.descripcion_puesto}. Requisitos obligatorios: ${vacante.requisitos}`;
    const analisisIA = await atsService.evaluarCandidato(textoCV, descripcionCompleta);

    if (!idCandidatoReal) {
      const { data: nuevoCandidato, error: errorCandidato } = await supabase
        .from('candidatos')
        .insert([{
          nombre,
          correo,
          telefono: telefono || null,
          enlace_linkedin: linkedin || null,
        }])
        .select('id_candidato')
        .single();

      if (errorCandidato) {
        if (errorCandidato.code === '23505') {
          const { data: candidatoConcurrente, error: errorConcurrente } = await supabase
            .from('candidatos')
            .select('id_candidato')
            .eq('correo', correo)
            .maybeSingle();

          if (errorConcurrente || !candidatoConcurrente) {
            throw new Error('No fue posible resolver el candidato existente.');
          }
          idCandidatoReal = candidatoConcurrente.id_candidato;
        } else {
          throw new Error(`Error de BD al crear candidato: ${errorCandidato.message}`);
        }
      } else {
        idCandidatoReal = nuevoCandidato.id_candidato;
      }
    }

    const { data: aplicacionConcurrente, error: errorConcurrente } = await supabase
      .from('aplicaciones_ats')
      .select('id_aplicacion')
      .eq('id_candidato', idCandidatoReal)
      .eq('id_vacante', idVacante)
      .maybeSingle();

    if (errorConcurrente) {
      throw new Error(`No fue posible validar la postulación: ${errorConcurrente.message}`);
    }
    if (aplicacionConcurrente) {
      return res.status(409).json({
        exito: false,
        error: 'Este candidato ya se postuló a esta vacante.',
      });
    }

    const baseNombre = safeFileComponent(nombre, 'candidato');
    const nombreArchivo = `cv_${Date.now()}_${baseNombre}.pdf`;
    storagePathCV = await uploadPrivatePdf('curriculums', nombreArchivo, archivo.buffer);

    const { error: errorAplicacion } = await supabase.from('aplicaciones_ats').insert([{
      id_vacante: idVacante,
      id_candidato: idCandidatoReal,
      estado_proceso: 'Recibida',
      ai_match_score: analisisIA.ai_match_score,
      ai_resumen_habilidades: analisisIA.ai_resumen_habilidades,
      url_archivo_cv: storagePathCV,
    }]);

    if (errorAplicacion) {
      if (errorAplicacion.code === '23505') {
        await removeStoredObject('curriculums', storagePathCV).catch(() => {});
        storagePathCV = null;
        return res.status(409).json({
          exito: false,
          error: 'Este candidato ya se postuló a esta vacante.',
        });
      }
      throw new Error(`Error al enlazar la aplicación: ${errorAplicacion.message}`);
    }

    storagePathCV = null;
    return res.status(201).json({
      exito: true,
      mensaje: 'Aplicación procesada y evaluada con éxito.',
    });
  } catch (error) {
    if (storagePathCV) {
      await removeStoredObject('curriculums', storagePathCV).catch((cleanupError) => {
        console.error('❌ No fue posible limpiar el CV huérfano:', cleanupError.message);
      });
    }
    next(error);
  }
});
module.exports = router;
