const bcrypt = require("bcrypt");

async function probarEncriptado() {
  console.log("🔒 Iniciando prueba de seguridad con Bcrypt...\n");

  // 1. La contraseña real que el usuario escribe en la pantalla
  const contrasenaOriginal = "MiSuperClave123!";
  console.log(
    `👤 Contraseña ingresada por el usuario: "${contrasenaOriginal}"`,
  );

  // 2. Generamos el "Salt" (un texto aleatorio para hacer la contraseña impredecible)
  // El número 10 es el "costo" o rondas de procesamiento. Mientras mayor el número, más seguro, pero más lento. 10 es el estándar.
  const saltRounds = 10;

  console.log("⚙️ Encriptando (Hashing)...");
  const contrasenaHasheada = await bcrypt.hash(contrasenaOriginal, saltRounds);

  console.log(`\n💾 ESTO ES LO QUE SE GUARDA EN LA BASE DE DATOS (Supabase):`);
  console.log(`👉 ${contrasenaHasheada}\n`);

  // 3. Simulamos un inicio de sesión
  console.log("🔄 Simulando un intento de Inicio de Sesión...");
  const intentoCorrecto = "MiSuperClave123!";
  const intentoIncorrecto = "misuperclave123!"; // Minúscula al inicio

  // Comparamos los intentos con el Hash guardado
  const matchCorrecto = await bcrypt.compare(
    intentoCorrecto,
    contrasenaHasheada,
  );
  const matchIncorrecto = await bcrypt.compare(
    intentoIncorrecto,
    contrasenaHasheada,
  );

  console.log(
    `Intento con "${intentoCorrecto}": ${matchCorrecto ? "✅ ACCESO CONCEDIDO" : "❌ DENEGADO"}`,
  );
  console.log(
    `Intento con "${intentoIncorrecto}": ${matchIncorrecto ? "✅ ACCESO CONCEDIDO" : "❌ DENEGADO"}`,
  );
}

probarEncriptado();
