# Requirements Document

## Introduction

La AFA (Asociación de Familias de Alumnos) del Colegio Público Perú de Carabanchel (Madrid) quiere ofrecer un asistente conversacional accesible a través de WhatsApp. El chatbot responderá automáticamente a preguntas frecuentes de las familias sobre actividades extraescolares, eventos del colegio, información sobre la AFA, el comedor y otros contenidos ya publicados en la web [afaceipperu.es](https://afaceipperu.es).

El sistema se construye íntegramente sobre servicios gratuitos y reutiliza la infraestructura existente: Green API (recepción y envío de mensajes WhatsApp), Gemini AI (generación de respuestas), Cloudflare Workers (endpoint serverless), y los ficheros de datos publicados en GitHub Pages (`data/eventos.json`, `data/extraescolares.json`).

## Glossary

- **Chatbot**: Sistema automatizado que recibe mensajes de WhatsApp de las familias y genera respuestas en lenguaje natural.
- **Green_API**: Plataforma utilizada para enviar y recibir mensajes de WhatsApp mediante webhooks y su API REST.
- **Gemini_AI**: Modelo de lenguaje de Google utilizado para generar respuestas a partir del contexto de la base de conocimiento.
- **Worker**: Función serverless alojada en Cloudflare Workers (capa gratuita) que actúa de endpoint para los webhooks de Green API.
- **Base_de_conocimiento**: Conjunto de datos estructurados y textuales obtenidos de la web de la AFA: `data/eventos.json`, `data/extraescolares.json` y contenido estático de las páginas HTML.
- **Webhook**: Llamada HTTP POST que Green API envía al Worker cada vez que llega un mensaje entrante al número de WhatsApp de la AFA.
- **Mensaje_entrante**: Mensaje de WhatsApp enviado por una familia al número de la AFA.
- **Respuesta_generada**: Texto producido por Gemini AI que el Worker envía de vuelta a la familia a través de Green API.
- **Contexto_del_prompt**: Fragmento de la Base_de_conocimiento relevante para la pregunta recibida, inyectado en el prompt enviado a Gemini AI.
- **GitHub_Pages**: Servicio de alojamiento estático de GitHub donde se publican la web y los ficheros JSON de datos.
- **GitHub_Actions**: Servicio de integración continua de GitHub, utilizado para actualizar los ficheros JSON diariamente desde Airtable.
- **Nivel_gratuito**: Restricciones de uso impuestas por cada proveedor sin coste económico (Green API, Gemini AI, Cloudflare Workers, GitHub Actions).

---

## Requirements

### Requirement 1: Recepción de mensajes entrantes

**User Story:** Como familia del Colegio Perú, quiero enviar un mensaje al número de WhatsApp de la AFA y recibir una respuesta automática, para resolver mis dudas sin necesitar esperar a que alguien lo atienda manualmente.

#### Acceptance Criteria

1. WHEN Green_API recibe un mensaje de WhatsApp en el número de la AFA, THE Green_API SHALL enviar una notificación HTTP POST al Worker con el contenido del mensaje, el identificador del remitente y el identificador del chat.
2. WHEN el Worker recibe la notificación de Green_API, THE Worker SHALL validar que el cuerpo de la petición contiene los campos `senderData.chatId`, `senderData.sender` y `messageData.textMessageData.textMessage`, y que el texto del mensaje no supera los 4.096 caracteres, antes de procesarlo.
3. IF el cuerpo de la petición recibida por el Worker no contiene los campos requeridos o el texto del mensaje supera los 4.096 caracteres, THEN THE Worker SHALL devolver una respuesta HTTP 200 sin procesar el mensaje, para evitar reintentos innecesarios de Green_API.
4. WHEN el Worker recibe una notificación en la que el campo `messageData` no contiene `textMessageData.textMessage` (indicando un tipo de mensaje no textual: imagen, audio, documento, sticker u otro), THE Worker SHALL responder al remitente con el texto: "Lo siento, solo puedo responder a mensajes de texto. Escríbeme tu pregunta y te ayudo 😊"
5. WHEN el Worker recibe un mensaje en el que `senderData.sender` coincide con el número de WhatsApp de la AFA configurado como variable de entorno `AFA_PHONE_NUMBER`, THE Worker SHALL descartar la notificación sin enviar ninguna respuesta.

---

### Requirement 2: Construcción del contexto para Gemini AI

**User Story:** Como sistema, quiero proporcionar a Gemini AI la información más relevante sobre la AFA para que sus respuestas sean precisas y actualizadas.

#### Acceptance Criteria

1. WHEN el Worker procesa un mensaje entrante, THE Worker SHALL obtener el contenido actualizado de `data/eventos.json` y `data/extraescolares.json` publicados en GitHub Pages mediante peticiones HTTP GET con un timeout máximo de 5 segundos por petición.
2. IF la petición HTTP GET a GitHub Pages devuelve un código de estado distinto de 200 o supera el timeout de 5 segundos, THEN THE Worker SHALL continuar el procesamiento utilizando únicamente el conocimiento estático incorporado en el prompt del sistema, e incluir en la Respuesta_generada la advertencia explícita: "⚠️ No he podido obtener los datos más recientes. La información sobre eventos o actividades podría no estar actualizada."
3. THE Worker SHALL incorporar en el prompt enviado a Gemini_AI un bloque de instrucciones del sistema que incluya: la identidad del chatbot como asistente de la AFA del Colegio Público Perú, el tono de comunicación en segunda persona informal (tú/vosotros), el idioma de respuesta (español), y la instrucción de responder únicamente con información presente en el contexto o en el conocimiento estático proporcionado.
4. THE Worker SHALL incluir en el Contexto_del_prompt: la lista de eventos con `fecha` mayor o igual a la fecha de la petición y `status` distinto de "Completado" desde `data/eventos.json` (nombre, fecha, hora y descripción), y la lista de actividades extraescolares con `activo: true` y `publicado: true` desde `data/extraescolares.json` (nombre, días, horario, precioSocio, precioNoSocio, empresa y participantes).
5. THE Worker SHALL limitar el Contexto_del_prompt a un máximo de 100.000 caracteres para mantenerse dentro del límite de tokens del Nivel_gratuito de Gemini_AI.

---

### Requirement 3: Generación de respuestas con Gemini AI

**User Story:** Como familia del Colegio Perú, quiero recibir respuestas precisas y naturales en español a mis preguntas, basadas en la información real de la web de la AFA.

#### Acceptance Criteria

1. WHEN el Worker envía una petición a Gemini_AI, THE Worker SHALL intentar primero con el modelo `gemini-2.0-flash` y, si devuelve un error 404 o 429, reintentar con `gemini-1.5-flash`, incluyendo en ambos casos el Contexto_del_prompt y el texto del mensaje entrante.
2. IF ninguno de los modelos devuelve una respuesta válida, THEN THE Worker SHALL responder al usuario con el mensaje de error genérico definido en el criterio 3 de este requisito.
3. IF la pregunta recibida no puede responderse con la información de la Base_de_conocimiento, THEN THE Chatbot SHALL responder indicando explícitamente que no dispone de esa información y sugerir que la familia contacte con la AFA por email a afaceipperu@gmail.com.
4. IF la petición a Gemini_AI devuelve un error HTTP o supera el tiempo de espera de 10 segundos, THEN THE Worker SHALL responder al usuario con el texto: "Ahora mismo no puedo procesar tu consulta. Por favor, inténtalo de nuevo en unos minutos o escríbenos a afaceipperu@gmail.com"
5. THE Chatbot SHALL responder siempre en español, con independencia del idioma en que esté redactado el mensaje entrante.
6. IF la Respuesta_generada supera los 1.600 caracteres, THEN THE Worker SHALL truncarla en el último espacio en blanco antes del límite y añadir "…\n\nPara más info: afaceipperu@gmail.com"

---

### Requirement 4: Envío de la respuesta al usuario

**User Story:** Como familia del Colegio Perú, quiero recibir la respuesta del chatbot directamente en el mismo chat de WhatsApp desde el que pregunté.

#### Acceptance Criteria

1. WHEN el Worker obtiene la Respuesta_generada de Gemini_AI, THE Worker SHALL enviar la respuesta al `senderData.chatId` original mediante la API `sendMessage` de Green_API.
2. IF la llamada a la API `sendMessage` de Green_API devuelve un código de estado distinto de 200, THEN THE Worker SHALL registrar el error en los logs de Cloudflare con el identificador del chat (hasheado con SHA-256), el código de error HTTP recibido y los primeros 500 caracteres del cuerpo de la respuesta fallida.
3. THE Worker SHALL devolver una respuesta HTTP 200 a Green_API en todos los casos (éxito o fallo en el envío), para evitar reintentos automáticos que podrían causar mensajes duplicados.
4. WHEN el Worker envía un mensaje mediante Green_API, THE Worker SHALL omitir del texto los caracteres `*`, `_`, `#`, los backticks (`` ` ``), y los corchetes `[` y `]` que no formen parte de una URL, para garantizar la visualización correcta en WhatsApp.
5. IF la Respuesta_generada es nula, vacía o solo contiene espacios en blanco, THEN THE Worker SHALL registrar el evento como `error_ai_provider` en los logs de Cloudflare y omitir la llamada a `sendMessage`.

---

### Requirement 5: Gestión de límites del nivel gratuito

**User Story:** Como administrador del sistema, quiero que el chatbot opere dentro de los límites gratuitos de todos los servicios, para que no genere ningún coste.

#### Acceptance Criteria

1. THE Worker SHALL completar el procesamiento de cada Mensaje_entrante —incluyendo la consulta a GitHub Pages, la llamada a Gemini_AI y el envío de la respuesta— en menos de 25 segundos, para mantenerse dentro del límite de tiempo de CPU del Nivel_gratuito de Cloudflare Workers.
2. IF el procesamiento total supera los 25 segundos, THEN THE Worker SHALL abortar la operación en curso, registrar el evento como `error_timeout` en los logs de Cloudflare y responder al usuario con el mensaje de error genérico del Requisito 3, criterio 4.
3. WHILE el Chatbot esté en operación, THE Worker SHALL invocar la API de Gemini_AI como máximo una vez por Mensaje_entrante, para no superar la cuota diaria del Nivel_gratuito (1.500 peticiones/día en `gemini-1.5-flash`).
4. IF un mismo remitente (identificado por `senderData.sender`) envía más de 10 mensajes en una ventana deslizante de 60 segundos, THEN THE Worker SHALL descartar los mensajes excedentes sin llamar a Gemini_AI y sin responder al remitente durante los 60 segundos siguientes al último mensaje descartado.
5. WHEN el Worker necesita datos de eventos o extraescolares, THE Worker SHALL obtenerlos exclusivamente desde las URLs públicas `https://afaceipperu.es/data/eventos.json` y `https://afaceipperu.es/data/extraescolares.json`, sin acceder a las API de Airtable ni a la API de GitHub.
6. IF la petición a GitHub Pages para obtener los ficheros JSON devuelve un error o supera el timeout de 10 segundos, THEN THE Worker SHALL abortar la petición, omitir los datos dinámicos del Contexto_del_prompt y continuar con el conocimiento estático, sin invocar a Gemini_AI hasta que el contexto estático esté listo.

---

### Requirement 6: Seguridad y autenticación del webhook

**User Story:** Como administrador del sistema, quiero que solo Green API pueda activar el webhook del Worker, para evitar llamadas no autorizadas.

#### Acceptance Criteria

1. WHEN el Worker recibe una petición HTTP, THE Worker SHALL verificar que la petición incluye el token secreto —bien como parámetro de la URL `?token=<valor>` o bien como cabecera HTTP `X-Webhook-Secret: <valor>`— y que la comparación se realiza de forma segura en tiempo constante para evitar ataques de temporización.
2. IF una petición al Worker no incluye el parámetro `token` ni la cabecera `X-Webhook-Secret`, o si el valor proporcionado no coincide con la variable de entorno `WEBHOOK_SECRET`, THEN THE Worker SHALL devolver una respuesta HTTP 403 sin procesar el cuerpo de la petición.
3. THE Worker SHALL obtener los valores de `GEMINI_API_KEY`, `GREENAPI_INSTANCE_ID`, `GREENAPI_TOKEN` y `WEBHOOK_SECRET` exclusivamente desde variables de entorno de Cloudflare Workers, de forma que ninguno de estos valores aparezca literalmente en el código fuente del Worker.

---

### Requirement 7: Observabilidad y mantenimiento

**User Story:** Como administrador del sistema, quiero poder revisar el comportamiento del chatbot y detectar errores, para mantener el servicio en buen estado.

#### Acceptance Criteria

1. WHEN el Worker procesa un Mensaje_entrante, THE Worker SHALL registrar en los logs de Cloudflare: el identificador del chat hasheado con SHA-256, el estado del procesamiento (uno de: `success`, `error_whatsapp_api`, `error_ai_provider`, `error_kv_storage`, `error_timeout`, `error_unhandled`) y la latencia total en milisegundos desde la recepción del webhook hasta el envío de la respuesta.
2. IF el Worker encuentra una excepción o una promesa rechazada no capturada por ningún bloque de manejo de errores explícito, THEN THE Worker SHALL registrar el stack trace completo en los logs de Cloudflare con estado `error_unhandled` y responder al usuario con el mensaje de error genérico definido en el Requisito 3, criterio 4.
3. THE Worker SHALL exponer un endpoint HTTP GET en la ruta `/health` que devuelva una respuesta HTTP 200 con el cuerpo `{"status": "ok"}` para permitir comprobaciones de disponibilidad.
4. WHEN el Worker registra cualquier evento de log, THE Worker SHALL incluir únicamente el identificador de chat hasheado con SHA-256 y los campos de estado y latencia definidos en el criterio 1, excluyendo el número de teléfono en texto claro y el contenido del mensaje.

---

### Requirement 8: Conocimiento estático de la AFA

**User Story:** Como familia del Colegio Perú, quiero poder preguntar sobre la AFA, las cuotas, cómo asociarme, el comedor y las comisiones, y recibir respuestas correctas aunque no estén en los ficheros JSON.

#### Acceptance Criteria

1. THE Worker SHALL incluir en el prompt del sistema de Gemini_AI un bloque de conocimiento estático que contenga, como mínimo: información sobre qué es la AFA y su historia, cómo asociarse y cuál es la cuota anual (25 €), beneficios de ser socio/a, información sobre el comedor y la Comisión de Comedor, información sobre las seis comisiones de trabajo (Comedor, Extraescolares, Huerto, Fiestas, Bicicletada y Consejo Escolar), información sobre las actividades familiares (Club Montaña, bicicletadas, huerto, fiestas), datos de contacto (afaceipperu@gmail.com) y el IBAN para pagos (ES09 0049 5156 7123 1656 5022).
2. WHEN el Chatbot recibe una pregunta sobre un dato disponible en el bloque de conocimiento estático, THE Chatbot SHALL incluir en la respuesta el dato específico tal y como está redactado en dicho bloque (por ejemplo, la cuota exacta de 25 €, el IBAN completo o el email de contacto).
3. IF el Chatbot recibe una pregunta que no puede responderse ni con el conocimiento estático ni con los ficheros JSON, THEN THE Chatbot SHALL indicar explícitamente que no dispone de esa información y dirigir al usuario al email afaceipperu@gmail.com.
4. THE Worker SHALL actualizar el bloque de conocimiento estático únicamente mediante una nueva versión del código del Worker, sin requerir ninguna infraestructura adicional de base de datos.
