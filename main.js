import { Resend } from 'resend';

const APPOINTMENTS_DATABASE_ID = '6a7f5e6e003c03fa340d';
const APPOINTMENTS_TABLE_ID = 'appointments';
const HYUNDAI_WORKSHOP_ID = 'hyundaicare';

const templates = {
  welcome: ({ name = 'cliente' }) => ({
    subject: 'Bienvenido a AutoCare',
    html: renderEmailLayout({
      eyebrow: 'CUENTA CREADA',
      title: 'Bienvenido a AutoCare',
      intro: `Hola ${escapeHtml(name)}, tu cuenta fue creada correctamente.`,
      body: '<p style="margin:0;color:#605a57;font-size:15px;line-height:1.7">Ya puedes registrar tus vehículos, consultar el asistente automotriz y agendar servicios con talleres disponibles.</p>',
      actionLabel: 'Entrar a AutoCare'
    })
  }),
  appointment: ({ name = 'cliente', workshop = 'tu taller', date = '', calendarDate = '', time = '', status = 'Solicitada', service = '', vehicle = '', reference = '', reason = '' }) => {
    const allowedStatuses = ['Solicitada', 'Confirmada', 'Rechazada', 'Cancelada', 'En servicio', 'Completada'];
    const safeStatus = allowedStatuses.includes(status) ? status : 'Solicitada';
    const titles = {
      Solicitada: 'Solicitud de cita recibida',
      Confirmada: 'Tu cita fue confirmada',
      Rechazada: 'Actualización de tu solicitud',
      Cancelada: 'Tu cita fue cancelada',
      'En servicio': 'Tu vehículo está en servicio',
      Completada: 'Servicio completado'
    };
    const descriptions = {
      Solicitada: 'Enviamos tu solicitud al taller. Recibirás otra notificación cuando responda.',
      Confirmada: 'El taller confirmó la fecha y la hora de tu servicio.',
      Rechazada: 'El taller no pudo aceptar esta solicitud. Puedes elegir otra fecha o consultar otro taller.',
      Cancelada: 'La cita fue cancelada y ya no aparece como activa en tu agenda.',
      'En servicio': 'El taller indicó que ya comenzó a trabajar con tu vehículo.',
      Completada: 'El taller marcó el servicio como completado. Puedes consultar el historial en tu perfil.'
    };
    const statusColors = {
      Solicitada: ['#fff4e5', '#9a5b00'],
      Confirmada: ['#e9f8ee', '#176b36'],
      Rechazada: ['#fbeaea', '#9b1c1c'],
      Cancelada: ['#f2f0ef', '#625b57'],
      'En servicio': ['#eaf3ff', '#175a9b'],
      Completada: ['#e9f8ee', '#176b36']
    };
    const [statusBackground, statusColor] = statusColors[safeStatus];
    const safeReference = reference || `AC-${String(date || 'CITA').replace(/\D/g, '').slice(-8) || 'CITA'}`;
    const calendarUrl = ['Solicitada', 'Confirmada'].includes(safeStatus)
      ? buildCalendarUrl({ workshop, service, vehicle, date: calendarDate || date, time, reference: safeReference })
      : '';
    const details = [
      ['Taller', workshop],
      ['Servicio', service || 'Servicio automotriz'],
      vehicle ? ['Vehículo', vehicle] : null,
      ['Fecha', date || 'Por confirmar'],
      ['Hora', time || 'Por confirmar'],
      ['Código', safeReference]
    ].filter(Boolean).map(([label, value]) => detailRow(label, value)).join('');
    return {
      subject: `${titles[safeStatus]} · AutoCare`,
      html: renderEmailLayout({
        eyebrow: 'ACTUALIZACIÓN DE CITA',
        title: titles[safeStatus],
        intro: `Hola ${escapeHtml(name)}, ${escapeHtml(descriptions[safeStatus])}`,
        body: `<div style="margin:22px 0 18px;padding:8px 18px;border:1px solid #e3ddda;border-radius:14px;background:#fff">${details}</div>
          <div style="display:inline-block;margin:0 0 18px;padding:7px 13px;border-radius:999px;background:${statusBackground};color:${statusColor};font-size:13px;font-weight:700">${escapeHtml(safeStatus)}</div>
          ${reason ? `<div style="margin:0 0 18px;padding:14px 16px;border-left:4px solid #981b1f;background:#faf5f4;color:#514b48;font-size:14px;line-height:1.6"><strong>Motivo:</strong> ${escapeHtml(reason)}</div>` : ''}
          <p style="margin:0;color:#706966;font-size:13px;line-height:1.6">Por seguridad, gestiona cualquier cambio desde tu cuenta de AutoCare.</p>`,
        actionLabel: 'Ver mi cita',
        secondaryActionLabel: calendarUrl ? 'Agregar al calendario' : '',
        secondaryActionUrl: calendarUrl
      })
    };
  }
};

function detailRow(label, value) {
  return `<div style="display:flex;gap:16px;justify-content:space-between;padding:11px 0;border-bottom:1px solid #eee9e7;font-size:14px;line-height:1.45">
    <span style="color:#7a736f">${escapeHtml(label)}</span>
    <strong style="color:#211e1c;text-align:right">${escapeHtml(value)}</strong>
  </div>`;
}

function buildCalendarUrl({ workshop, service, vehicle, date, time, reference }) {
  const dateMatch = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(time).trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!dateMatch || !timeMatch) return '';

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const period = String(timeMatch[3] || '').toUpperCase();
  if (period === 'PM' && hour < 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return '';

  const day = `${dateMatch[1]}${dateMatch[2]}${dateMatch[3]}`;
  const startMinutes = (hour * 60) + minute;
  const endMinutes = startMinutes + 60;
  const start = `${day}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`;
  const endHour = Math.floor(endMinutes / 60) % 24;
  const endMinute = endMinutes % 60;
  const end = `${day}T${String(endHour).padStart(2, '0')}${String(endMinute).padStart(2, '0')}00`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${service || 'Servicio automotriz'} · AutoCare`,
    dates: `${start}/${end}`,
    ctz: 'America/Santo_Domingo',
    details: `Cita gestionada mediante AutoCare. Vehículo: ${vehicle || 'Por confirmar'}. Código: ${reference}`,
    location: workshop || 'Taller AutoCare'
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function renderEmailLayout({ eyebrow, title, intro, body, actionLabel, secondaryActionLabel = '', secondaryActionUrl = '' }) {
  const appUrl = 'https://autocarerd.app/autocare-prototype.html?role=user&page=profile';
  return `<!doctype html>
  <html lang="es">
    <body style="margin:0;padding:0;background:#f4f1ef;font-family:Arial,Helvetica,sans-serif;color:#211e1c">
      <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(title)} en AutoCare</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ef;padding:28px 12px">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #ded7d3;border-radius:20px;overflow:hidden;box-shadow:0 12px 30px rgba(54,38,33,.08)">
            <tr><td style="padding:24px 30px;background:#741114">
              <div style="font-size:26px;font-weight:800;letter-spacing:-.8px;color:#ffffff">Auto<span style="color:#f2c4c4">Care</span></div>
              <div style="margin-top:4px;color:#eecaca;font-size:11px;letter-spacing:2px">ASISTENTE AUTOMOTRIZ</div>
            </td></tr>
            <tr><td style="padding:32px 30px 30px">
              <div style="margin-bottom:10px;color:#981b1f;font-size:11px;font-weight:800;letter-spacing:1.8px">${escapeHtml(eyebrow)}</div>
              <h1 style="margin:0 0 12px;font-size:27px;line-height:1.2;letter-spacing:-.5px;color:#211e1c">${escapeHtml(title)}</h1>
              <p style="margin:0;color:#605a57;font-size:15px;line-height:1.7">${intro}</p>
              ${body}
              <div style="margin-top:24px">
                <a href="${appUrl}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#981b1f;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">${escapeHtml(actionLabel)}</a>
                ${secondaryActionUrl ? `<a href="${escapeHtml(secondaryActionUrl)}" style="display:inline-block;margin-left:8px;padding:12px 19px;border:1px solid #981b1f;border-radius:10px;background:#ffffff;color:#981b1f;text-decoration:none;font-size:14px;font-weight:700">${escapeHtml(secondaryActionLabel)}</a>` : ''}
              </div>
            </td></tr>
            <tr><td style="padding:18px 30px;border-top:1px solid #eee8e5;background:#faf8f7;color:#817975;font-size:11px;line-height:1.6">
              Este mensaje fue enviado automáticamente por AutoCare. Si no reconoces esta actividad, no respondas al correo y revisa la seguridad de tu cuenta.<br>
              © 2026 AutoCare · República Dominicana
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[character]);
}

async function resolveAuthenticatedEmail(req) {
  const forwardedEmail = String(req.headers['x-appwrite-user-email'] || '').trim().toLowerCase();
  if (forwardedEmail) return forwardedEmail;

  const jwt = String(req.headers['x-autocare-user-jwt'] || '').trim();
  if (!jwt) return '';
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://nyc.cloud.appwrite.io/v1';
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID || '6a6663210001b82b881d';
  const response = await fetch(`${endpoint}/account`, {
    headers: {
      'X-Appwrite-Project': projectId,
      'X-Appwrite-JWT': jwt
    }
  });
  if (!response.ok) return '';
  const account = await response.json();
  return String(account.email || '').trim().toLowerCase();
}

async function resolveAuthenticatedUser(req) {
  const jwt = String(req.headers['x-autocare-user-jwt'] || '').trim();
  if (jwt) {
    const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://nyc.cloud.appwrite.io/v1';
    const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID || '6a6663210001b82b881d';
    const response = await fetch(`${endpoint}/account`, {
      headers: { 'X-Appwrite-Project': projectId, 'X-Appwrite-JWT': jwt }
    });
    if (response.ok) {
      const user = await response.json();
      return { id:String(user.$id || ''), email:String(user.email || '').trim().toLowerCase(), role:String(user.prefs?.role || '') };
    }
  }
  const forwardedId = String(req.headers['x-appwrite-user-id'] || '').trim();
  const forwardedEmail = String(req.headers['x-appwrite-user-email'] || '').trim().toLowerCase();
  return forwardedId ? { id:forwardedId, email:forwardedEmail, role:'' } : null;
}

function appwriteServerConfig() {
  return {
    endpoint: process.env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://nyc.cloud.appwrite.io/v1',
    projectId: process.env.APPWRITE_FUNCTION_PROJECT_ID || '6a6663210001b82b881d',
    apiKey: process.env.AUTOCARE_DATA_API_KEY || process.env.AUTOCARE_USERS_API_KEY || process.env.APPWRITE_FUNCTION_API_KEY
  };
}

async function appwriteDataRequest(path, options = {}) {
  const { endpoint, projectId, apiKey } = appwriteServerConfig();
  if (!apiKey) {
    const missingKey = new Error('Clave de datos no configurada');
    missingKey.code = 'APPOINTMENT_KEY_MISSING';
    throw missingKey;
  }
  const response = await fetch(`${endpoint}${path}`, {
    ...options,
    headers: {
      'Content-Type':'application/json',
      'X-Appwrite-Project':projectId,
      'X-Appwrite-Key':apiKey,
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    let details = {};
    try { details = await response.json(); } catch (_) {}
    const requestError = new Error(details.message || `Solicitud de datos rechazada (${response.status})`);
    requestError.code = response.status === 401 ? 'APPOINTMENT_SCOPE_MISSING' : 'APPOINTMENT_DATA_ERROR';
    throw requestError;
  }
  if (response.status === 204) return {};
  return response.json();
}

function parseAppointmentRow(row) {
  try { return { ...JSON.parse(row?.payload || '{}'), cloudId:row?.$id, userId:row?.userId, workshopId:row?.workshopId }; }
  catch (_) { return null; }
}

function isAuthorizedHyundaiShop(user) {
  const authorizedEmail = String(process.env.AUTOCARE_HYUNDAI_SHOP_EMAIL || '').trim().toLowerCase();
  // El correo configurado es la autorización del taller. No se exige un rol
  // exclusivo porque una misma identidad puede conservar también su perfil
  // de conductor dentro del happy path de demostración.
  return Boolean(authorizedEmail && user?.email === authorizedEmail);
}

async function listWorkshopAppointments(req, res, log) {
  const user = await resolveAuthenticatedUser(req);
  if (!isAuthorizedHyundaiShop(user)) return res.json({ error:'Cuenta de taller no autorizada', code:'SHOP_NOT_AUTHORIZED' }, 403);
  const result = await appwriteDataRequest(`/tablesdb/${APPOINTMENTS_DATABASE_ID}/tables/${APPOINTMENTS_TABLE_ID}/rows?total=false&ttl=0`);
  const appointments = (result.rows || []).map(parseAppointmentRow).filter(item => item?.workshopId === HYUNDAI_WORKSHOP_ID);
  log(`appointments-list: ${appointments.length} citas para ${HYUNDAI_WORKSHOP_ID}`);
  return res.json({ ok:true, appointments });
}

async function updateWorkshopAppointment(req, res, log, body) {
  const user = await resolveAuthenticatedUser(req);
  if (!isAuthorizedHyundaiShop(user)) return res.json({ error:'Cuenta de taller no autorizada', code:'SHOP_NOT_AUTHORIZED' }, 403);
  const rowId = String(body.cloudId || '').trim();
  const status = String(body.status || '').trim();
  const allowedStatuses = ['Confirmada','Rechazada','En servicio','Completada'];
  if (!rowId || !allowedStatuses.includes(status)) return res.json({ error:'Actualización de cita inválida', code:'APPOINTMENT_INVALID' }, 400);

  const path = `/tablesdb/${APPOINTMENTS_DATABASE_ID}/tables/${APPOINTMENTS_TABLE_ID}/rows/${encodeURIComponent(rowId)}`;
  const row = await appwriteDataRequest(path);
  const appointment = parseAppointmentRow(row);
  if (!appointment || appointment.workshopId !== HYUNDAI_WORKSHOP_ID) return res.json({ error:'Cita no autorizada', code:'APPOINTMENT_FORBIDDEN' }, 403);
  const changedAt = new Date().toISOString();
  const updated = {
    ...appointment,
    estado:status,
    ...(body.reason ? { decisionReason:String(body.reason).slice(0,300) } : {}),
    updated:changedAt,
    statusHistory:[...(Array.isArray(appointment.statusHistory) ? appointment.statusHistory : []), { status, actor:'shop', date:changedAt }]
  };
  delete updated.cloudId;
  delete updated.userId;
  await appwriteDataRequest(path, {
    method:'PATCH',
    body:JSON.stringify({ data:{ userId:row.userId, workshopId:row.workshopId, payload:JSON.stringify(updated) } })
  });

  let emailSent = false;
  if (process.env.RESEND_API_KEY && updated.clientEmail) {
    const content = templates.appointment({
      name:updated.cliente, workshop:updated.taller, date:updated.fecha, calendarDate:updated.dateKey,
      time:updated.hora, status:updated.estado, service:updated.service, vehicle:updated.vehiculo,
      reference:rowId, reason:updated.decisionReason || ''
    });
    const deliveryRecipient = String(process.env.RESEND_TEST_RECIPIENT || '').trim() || updated.clientEmail;
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from:process.env.RESEND_FROM_EMAIL || 'AutoCare <onboarding@resend.dev>',
      to:[deliveryRecipient], subject:process.env.RESEND_TEST_RECIPIENT ? `[PRUEBA] ${content.subject}` : content.subject, html:content.html
    });
    emailSent = !result.error;
  }
  log(`appointment-update: ${rowId} -> ${status}; email=${emailSent}`);
  return res.json({ ok:true, appointment:{ ...updated, cloudId:rowId }, emailSent });
}

async function deleteAuthenticatedUser(req, res, log) {
  const authenticatedUser = await resolveAuthenticatedUser(req);
  if (!authenticatedUser?.id) {
    log('account-delete: identidad de usuario no disponible');
    return res.json({ error: 'Autenticación requerida', code: 'DELETE_AUTH_REQUIRED' }, 401);
  }
  const apiKey = process.env.APPWRITE_FUNCTION_API_KEY || process.env.AUTOCARE_USERS_API_KEY;
  if (!apiKey) {
    log('account-delete: clave de servidor no disponible');
    return res.json({ error: 'Eliminación de cuenta no configurada', code: 'DELETE_KEY_MISSING' }, 503);
  }

  try {
    const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT || 'https://nyc.cloud.appwrite.io/v1';
    const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID || '6a6663210001b82b881d';
    const response = await fetch(`${endpoint}/users/${encodeURIComponent(authenticatedUser.id)}`, {
      method: 'DELETE',
      headers: {
        'X-Appwrite-Project': projectId,
        'X-Appwrite-Key': apiKey
      }
    });
    if (!response.ok) {
      let details = {};
      try { details = await response.json(); } catch (_) {}
      log(`account-delete: Appwrite rechazó la operación (${response.status}:${details.type || 'sin tipo'})`);
      return res.json({ error: 'Permiso insuficiente para eliminar la cuenta', code: 'DELETE_SCOPE_MISSING' }, 503);
    }
  } catch (exception) {
    log(`account-delete: error de conexión con Appwrite (${exception.name || 'sin tipo'})`);
    return res.json({ error: 'No fue posible conectar con el servicio de cuentas', code: 'DELETE_SERVICE_UNAVAILABLE' }, 503);
  }
  return res.json({ ok: true });
}

export default async ({ req, res, log, error }) => {
  if (req.method !== 'POST') return res.json({ error: 'Método no permitido' }, 405);

  try {
    const body = req.bodyJson || {};
    if (body.action === 'delete-account') return await deleteAuthenticatedUser(req, res, log);
    if (body.action === 'list-workshop-appointments') return await listWorkshopAppointments(req, res, log);
    if (body.action === 'update-workshop-appointment') return await updateWorkshopAppointment(req, res, log, body);
    if (!process.env.RESEND_API_KEY) return res.json({ error: 'Servicio de correo no configurado' }, 503);
    const template = templates[body.template];
    if (!template || !body.to) return res.json({ error: 'Solicitud de correo inválida' }, 400);
    const authenticatedUser = await resolveAuthenticatedUser(req);
    const authenticatedEmail = authenticatedUser?.email || await resolveAuthenticatedEmail(req);
    if (!authenticatedEmail) return res.json({ error: 'Autenticación requerida' }, 401);
    const recipientEmail = String(body.to).trim().toLowerCase();
    const demoRecipient = String(process.env.RESEND_TEST_RECIPIENT || '').trim().toLowerCase();
    const appointmentStatuses = ['Confirmada','Rechazada','Cancelada','En servicio','Completada'];
    const workshopUpdate = authenticatedUser?.role === 'shop' && body.template === 'appointment' && appointmentStatuses.includes(body.data?.status);
    // En el prototipo, un taller solo puede notificar al destinatario de prueba
    // configurado por la administradora. Evita convertir la función en un emisor abierto.
    const allowedWorkshopRecipient = workshopUpdate && demoRecipient && recipientEmail === demoRecipient;
    if (recipientEmail !== authenticatedEmail && !allowedWorkshopRecipient) {
      return res.json({ error: 'El destinatario debe ser el usuario autenticado' }, 403);
    }

    // Permite probar Resend con su dominio de pruebas sin exponer ni fijar el
    // correo autorizado en el cliente. Si la variable no existe, producción
    // conserva el destinatario autenticado solicitado originalmente.
    const testRecipient = String(process.env.RESEND_TEST_RECIPIENT || '').trim();
    const deliveryRecipient = testRecipient || body.to;

    const content = template(body.data || {});
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'AutoCare <onboarding@resend.dev>',
      to: [deliveryRecipient],
      subject: testRecipient ? `[PRUEBA] ${content.subject}` : content.subject,
      html: content.html
    });

    if (result.error) throw new Error(result.error.message);
    return res.json({ ok: true, id: result.data?.id, testRedirected: Boolean(testRecipient) });
  } catch (exception) {
    error(exception.message);
    const appointmentError = String(exception.code || '').startsWith('APPOINTMENT_');
    return res.json({
      error: appointmentError ? 'No fue posible sincronizar las citas del taller' : 'No fue posible enviar el correo',
      code:exception.code || 'FUNCTION_ERROR'
    }, appointmentError ? 503 : 500);
  }
};
