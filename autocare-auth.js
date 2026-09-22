(function () {
  'use strict';

  const CONFIG = Object.freeze({
    endpoint: 'https://nyc.cloud.appwrite.io/v1',
    projectId: '6a6663210001b82b881d'
  });

  if (!window.Appwrite) {
    console.error('No se pudo cargar el SDK de Appwrite.');
    return;
  }

  const client = new Appwrite.Client()
    .setEndpoint(CONFIG.endpoint)
    .setProject(CONFIG.projectId);
  const account = new Appwrite.Account(client);
  const avatars = new Appwrite.Avatars(client);
  const functions = new Appwrite.Functions(client);
  const EMAIL_FUNCTION_ID = '6a78d0860001fa35d875';
  let pendingChallengeId = '';
  let pendingRoute = '';
  let mfaSetupInProgress = false;

  const routes = {
    user: 'autocare-prototype.html?role=user&page=home',
    shop: 'autocare-prototype.html?role=shop&page=panel&workshop=hyundaicare',
    admin: 'autocare-prototype.html?role=admin&page=admin'
  };

  function messageFor(error) {
    const type = error?.type || '';
    if (type === 'user_invalid_credentials') return 'Correo o contraseña incorrectos.';
    if (type === 'user_blocked') return 'Esta cuenta está temporalmente bloqueada. Contacta al equipo de AutoCare.';
    if (type === 'user_email_not_whitelisted') return 'Este correo todavía no tiene acceso autorizado.';
    if (type === 'user_session_already_exists') return 'Ya existe una sesión activa. Recarga la página e inténtalo nuevamente.';
    if (type === 'user_already_exists') return 'Ya existe una cuenta con este correo.';
    if (type === 'password_recently_used') return 'Utiliza una contraseña diferente.';
    if (type === 'general_rate_limit_exceeded') return 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.';
    if (type === 'user_invalid_token') return 'El enlace venció o ya fue utilizado. Solicita uno nuevo.';
    if (type === 'user_not_found') return 'No encontramos una cuenta activa con esos datos.';
    if (type === 'general_smtp_disabled') return 'El correo no pudo enviarse en este momento. Inténtalo nuevamente más tarde.';
    if (type === 'general_argument_invalid') return 'La solicitud contiene un dato inválido. Revisa el correo e inténtalo nuevamente.';
    if (type === 'network_request_failed' || /failed to fetch|network/i.test(error?.message || '')) return 'No pudimos conectar con el servicio. Revisa tu conexión y recarga la página.';
    if (Number(error?.code) >= 500) return 'El servicio de acceso está temporalmente indisponible. Inténtalo nuevamente en unos minutos.';
    return 'No fue posible completar la solicitud. Verifica tus datos o intenta recuperar tu contraseña.';
  }

  function isAuthenticatorAlreadyVerified(error) {
    return error?.type === 'user_authenticator_already_verified' || /authenticator is already verified/i.test(error?.message || '');
  }

  function toast(icon, message) {
    if (typeof window.showToast === 'function') window.showToast(icon, message);
    else alert(message);
  }

  function requireHostedAuth() {
    if (window.location.protocol !== 'file:') return true;
    toast('🌐', 'El acceso requiere la versión publicada. Abriendo AutoCare seguro…');
    setTimeout(() => {
      window.location.href = 'https://autocarerd.app/autocare-landing.html';
    }, 900);
    return false;
  }

  function setBusy(label) {
    const button = document.querySelector('.modal-submit, #modalBox .btn-primary');
    if (!button) return;
    button.disabled = true;
    button.dataset.originalLabel ||= button.textContent;
    button.textContent = label;
  }

  function clearBusy() {
    const button = document.querySelector('.modal-submit, #modalBox .btn-primary');
    if (!button) return;
    button.disabled = false;
    if (button.dataset.originalLabel) button.textContent = button.dataset.originalLabel;
  }

  function saveBrowserSession(user, role) {
    const ownerKey = 'autocareProfileOwner';
    const newOwner = String(user.email || user.$id || '').trim().toLowerCase();
    const previousOwner = localStorage.getItem(ownerKey) || '';
    // No reutilizar en otra cuenta los vehículos y datos locales del perfil anterior.
    if (newOwner && previousOwner !== newOwner) {
      let savedProfileEmail = '';
      try {
        savedProfileEmail = String(JSON.parse(localStorage.getItem('autocareUserProfile') || 'null')?.email || '').trim().toLowerCase();
      } catch (_) {}
      // En la primera ejecución conserva un perfil que ya pertenezca a esta misma cuenta.
      if (previousOwner || savedProfileEmail !== newOwner) localStorage.removeItem('autocareUserProfile');
      localStorage.setItem(ownerKey, newOwner);
    }
    sessionStorage.setItem('autocareRole', role);
    sessionStorage.setItem('autocareEmail', user.email || '');
    sessionStorage.setItem('autocareName', user.name || '');
  }

  async function resolveRole(user, requestedRole) {
    const prefs = user?.prefs || {};
    const role = prefs.role || requestedRole || 'user';
    return ['user', 'shop', 'admin'].includes(role) ? role : 'user';
  }

  async function finishLogin(requestedRole) {
    const user = await account.get();
    const role = await resolveRole(user, requestedRole);
    saveBrowserSession(user, role);
    window.location.href = routes[role];
  }

  async function sendTransactionalEmail(template, to, data = {}) {
    if (!to) return null;
    const jwt = await account.createJWT();
    const execution = await functions.createExecution({
      functionId: EMAIL_FUNCTION_ID,
      body: JSON.stringify({ template, to, data }),
      async: false,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-autocare-user-jwt': jwt.jwt
      }
    });
    if (execution.responseStatusCode >= 400) {
      throw new Error('El servicio de correo rechazó la solicitud.');
    }
    return execution;
  }

  async function executeBackendAction(action, data = {}) {
    const jwt = await account.createJWT();
    const execution = await functions.createExecution({
      functionId: EMAIL_FUNCTION_ID,
      body: JSON.stringify({ action, ...data }),
      async: false,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-autocare-user-jwt': jwt.jwt
      }
    });
    let response = {};
    try { response = JSON.parse(execution.responseBody || '{}'); } catch (_) {}
    if (execution.responseStatusCode >= 400) {
      const requestError = new Error(response.error || 'No fue posible completar la operación.');
      requestError.code = response.code || 'BACKEND_ACTION_FAILED';
      throw requestError;
    }
    return response;
  }

  function otpInputs(prefix, callbackName) {
    return Array.from({ length: 6 }, (_, index) => `
      <input id="${prefix}${index}" type="text" maxlength="1" inputmode="numeric"
        aria-label="Dígito ${index + 1}"
        style="width:44px;height:54px;text-align:center;font-size:1.45rem;font-weight:700;border:2px solid var(--border);border-radius:10px;background:var(--surface2);color:var(--text);font-family:monospace;outline:none"
        oninput="this.value=this.value.replace(/\\D/g,'');if(this.value&&${index}<5)document.getElementById('${prefix}${index + 1}')?.focus();if(this.value&&${index}===5)${callbackName}()"
        onkeydown="if(event.key==='Backspace'&&!this.value&&${index}>0)document.getElementById('${prefix}${index - 1}')?.focus()">`
    ).join('');
  }

  function readOtp(prefix) {
    return Array.from({ length: 6 }, (_, index) =>
      document.getElementById(`${prefix}${index}`)?.value || ''
    ).join('');
  }

  async function showTotpSetup(requestedRole) {
    try {
      const authenticator = await account.createMfaAuthenticator({ type: 'totp' });
      const qrUrl = avatars.getQR({
        text: authenticator.uri,
        size: 420,
        margin: 1,
        download: false
      });
      window._autoCarePendingRole = requestedRole;
      const box = document.getElementById('modalBox');
      box.innerHTML = `
        <div class="modal-head">
          <h3>Configura tu autenticador</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-sub">Este paso es obligatorio y solo se realiza una vez.</div>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:18px 0">
          <img src="${qrUrl}" alt="Código QR para configurar MFA" style="width:160px;height:160px;border:1px solid var(--border);border-radius:12px">
          <div style="flex:1;min-width:210px;font-size:.84rem;color:var(--text-muted)">
            <p>1. Abre Google Authenticator, Microsoft Authenticator o Authy.</p>
            <p>2. Escanea el código QR.</p>
            <p>3. Escribe abajo el código de seis dígitos.</p>
            <div style="margin-top:12px;padding:9px;border-radius:8px;background:var(--surface2);word-break:break-all">
              Clave manual: <strong>${authenticator.secret}</strong>
            </div>
          </div>
        </div>
        <div id="mfaInputs" style="display:flex;gap:8px;justify-content:center;margin-bottom:18px">
          ${otpInputs('realSetupOtp', 'verifyRealTotpSetup')}
        </div>
        <button class="modal-submit" onclick="verifyRealTotpSetup()">Activar MFA y continuar</button>`;
      setTimeout(() => document.getElementById('realSetupOtp0')?.focus(), 50);
    } catch (error) {
      if (error?.type === 'user_authenticator_already_exists' || isAuthenticatorAlreadyVerified(error)) {
        await completeMfaSetup(requestedRole);
        return;
      }
      toast('❌', messageFor(error));
    }
  }

  async function completeMfaSetup(requestedRole) {
    const user = await account.get();
    const role = await resolveRole(user, requestedRole);
    await account.updateMFA({ mfa: true });
    saveBrowserSession(user, role);
    sendTransactionalEmail('welcome', user.email, { name: user.name }).catch(error => {
      console.warn('No se pudo enviar el correo de bienvenida:', error.message);
    });
    const box = document.getElementById('modalBox');
    box.innerHTML = `
      <div class="modal-head"><h3>MFA activado correctamente</h3></div>
      <p class="modal-sub">Tu aplicación autenticadora quedó vinculada. Se solicitará un código temporal cada vez que inicies sesión.</p>
      <button class="modal-submit" onclick="window.location.href='${routes[role]}'">Continuar</button>`;
  }

  async function verifyRealTotpSetup() {
    if (mfaSetupInProgress) return;
    const otp = readOtp('realSetupOtp');
    if (otp.length !== 6) return toast('⚠️', 'Completa los seis dígitos.');
    mfaSetupInProgress = true;
    setBusy('Verificando…');
    try {
      try {
        await account.updateMfaAuthenticator({ type: 'totp', otp });
      } catch (error) {
        if (!isAuthenticatorAlreadyVerified(error)) throw error;
      }
      await completeMfaSetup(window._autoCarePendingRole);
    } catch (error) {
      mfaSetupInProgress = false;
      clearBusy();
      toast('❌', messageFor(error));
    }
  }

  async function startMfaChallenge(requestedRole) {
    const factors = await account.listMfaFactors();
    if (!factors.totp) return showTotpSetup(requestedRole);
    const challenge = await account.createMfaChallenge({ factor: 'totp' });
    pendingChallengeId = challenge.$id;
    pendingRoute = requestedRole || '';
    const box = document.getElementById('modalBox');
    box.innerHTML = `
      <div class="modal-head">
        <h3>Verificación en dos pasos</h3>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div style="text-align:center;margin:12px 0 20px">
        <div style="font-size:38px">🔐</div>
        <p style="margin-top:8px;color:var(--text-muted)">Ingresa el código actual de tu aplicación autenticadora.</p>
      </div>
      <div id="mfaInputs" style="display:flex;gap:8px;justify-content:center;margin-bottom:20px">
        ${otpInputs('realLoginOtp', 'verifyRealMfaChallenge')}
      </div>
      <button class="modal-submit" onclick="verifyRealMfaChallenge()">Verificar e ingresar</button>`;
    setTimeout(() => document.getElementById('realLoginOtp0')?.focus(), 50);
  }

  async function verifyRealMfaChallenge() {
    const otp = readOtp('realLoginOtp');
    if (otp.length !== 6) return toast('⚠️', 'Completa los seis dígitos.');
    setBusy('Verificando…');
    try {
      await account.updateMfaChallenge({ challengeId: pendingChallengeId, otp });
      await finishLogin(pendingRoute);
    } catch (error) {
      clearBusy();
      toast('❌', messageFor(error));
    }
  }

  async function startSession(requestedRole) {
    if (!requireHostedAuth()) return;
    const email = document.getElementById('modalEmail')?.value.trim();
    const password = document.getElementById('modalPassword')?.value || '';
    if (!email || !password) return toast('⚠️', 'Completa el correo y la contraseña.');
    setBusy('Ingresando…');
    try {
      let hasActiveSession = false;
      try {
        await account.get();
        hasActiveSession = true;
      } catch (_) {}
      if (hasActiveSession) {
        await account.deleteSession({ sessionId: 'current' });
      }
      await account.createEmailPasswordSession({ email, password });
      try {
        const user = await account.get();
        const accountRole = ['user', 'shop', 'admin'].includes(user?.prefs?.role) ? user.prefs.role : 'user';
        if (requestedRole && requestedRole !== accountRole) {
          await account.deleteSession({ sessionId: 'current' });
          clearBusy();
          const portal = accountRole === 'shop' ? 'panel del taller' : 'acceso para conductores';
          toast('⚠️', `Esta cuenta pertenece al ${portal}. Utiliza la opción de inicio de sesión correspondiente.`);
          return;
        }
        const factors = await account.listMfaFactors();
        clearBusy();
        if (!factors.totp || !user.mfa) return showTotpSetup(requestedRole);
        return finishLogin(requestedRole);
      } catch (error) {
        if (error?.type === 'user_more_factors_required') {
          clearBusy();
          return startMfaChallenge(requestedRole);
        }
        throw error;
      }
    } catch (error) {
      clearBusy();
      toast('❌', messageFor(error));
    }
  }

  function showPasswordRecovery(role = 'user') {
    const box = document.getElementById('modalBox');
    if (!box) return;
    box.innerHTML = `
      <div class="modal-head">
        <h3>Recuperar contraseña</h3>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-sub">Escribe el correo de tu cuenta y te enviaremos un enlace seguro.</div>
      <div class="modal-field">
        <label>Correo electrónico</label>
        <input id="recoveryEmail" type="email" autocomplete="email" placeholder="tucorreo@email.com">
      </div>
      <button class="modal-submit" onclick="sendPasswordRecovery('${role}')">Enviar enlace</button>
      <div class="modal-footer-text"><a onclick="openModal('${role}','login')">Volver a iniciar sesión</a></div>`;
    document.getElementById('overlay')?.classList.add('open');
    setTimeout(() => document.getElementById('recoveryEmail')?.focus(), 50);
  }

  async function sendPasswordRecovery(role = 'user') {
    if (!requireHostedAuth()) return;
    const email = document.getElementById('recoveryEmail')?.value.trim() || '';
    if (!email) return toast('⚠️', 'Escribe el correo de tu cuenta.');
    setBusy('Enviando…');
    try {
      const redirectUrl = `${window.location.origin}${window.location.pathname}?mode=recovery&role=${encodeURIComponent(role)}`;
      await account.createRecovery({ email, url: redirectUrl });
      const box = document.getElementById('modalBox');
      box.innerHTML = `
        <div class="modal-head"><h3>Revisa tu correo</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
        <div style="text-align:center;margin:12px 0 20px">
          <div style="font-size:42px">📧</div>
          <p style="margin:12px 0 6px;font-weight:700">Enlace de recuperación enviado</p>
          <p style="color:var(--text-muted);font-size:.86rem;line-height:1.6">Abre el mensaje de AutoCare y pulsa el enlace para crear una contraseña nueva. Revisa también la carpeta de correo no deseado.</p>
        </div>
        <button class="modal-submit" onclick="openModal('${role}','login')">Volver al inicio de sesión</button>`;
    } catch (error) {
      clearBusy();
      toast('❌', messageFor(error));
    }
  }

  function showPasswordReset(userId, secret, role = 'user') {
    const box = document.getElementById('modalBox');
    if (!box || !userId || !secret) return;
    window._autoCareRecovery = { userId, secret, role };
    box.innerHTML = `
      <div class="modal-head"><h3>Crea una contraseña nueva</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="modal-sub">Debe tener al menos ocho caracteres.</div>
      <div class="modal-field"><label>Nueva contraseña</label><input id="recoveryPassword" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div>
      <div class="modal-field"><label>Confirmar contraseña</label><input id="recoveryPasswordConfirm" type="password" autocomplete="new-password" placeholder="Repite la contraseña"></div>
      <button class="modal-submit" onclick="completePasswordRecovery()">Guardar contraseña</button>`;
    document.getElementById('overlay')?.classList.add('open');
    setTimeout(() => document.getElementById('recoveryPassword')?.focus(), 50);
  }

  async function completePasswordRecovery() {
    const recovery = window._autoCareRecovery;
    const password = document.getElementById('recoveryPassword')?.value || '';
    const confirmation = document.getElementById('recoveryPasswordConfirm')?.value || '';
    if (!recovery) return toast('❌', 'El enlace de recuperación no es válido.');
    if (password.length < 8) return toast('⚠️', 'La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirmation) return toast('⚠️', 'Las contraseñas no coinciden.');
    setBusy('Guardando…');
    try {
      await account.updateRecovery({ userId: recovery.userId, secret: recovery.secret, password });
      history.replaceState({}, document.title, window.location.pathname);
      window._autoCareRecovery = null;
      const box = document.getElementById('modalBox');
      box.innerHTML = `
        <div class="modal-head"><h3>Contraseña actualizada</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
        <div style="text-align:center;margin:12px 0 20px"><div style="font-size:42px">✅</div><p style="margin:12px 0;color:var(--text-muted)">Ya puedes iniciar sesión con tu contraseña nueva.</p></div>
        <button class="modal-submit" onclick="openModal('${recovery.role}','login')">Iniciar sesión</button>`;
    } catch (error) {
      clearBusy();
      toast('❌', messageFor(error));
    }
  }

  async function registerSession(role) {
    if (!requireHostedAuth()) return;
    const name = document.getElementById('modalName')?.value.trim();
    const email = document.getElementById('modalEmail')?.value.trim();
    const password = document.getElementById('modalPassword')?.value || '';
    if (!name || !email || !password) return toast('⚠️', 'Completa todos los campos.');
    if (password.length < 8) return toast('⚠️', 'La contraseña debe tener al menos 8 caracteres.');
    setBusy('Creando cuenta…');
    try {
      await account.create({
        userId: Appwrite.ID.unique(),
        email,
        password,
        name
      });
      await account.createEmailPasswordSession({ email, password });
      await account.updatePrefs({ prefs: { role } });
      clearBusy();
      await showTotpSetup(role);
    } catch (error) {
      clearBusy();
      toast('❌', messageFor(error));
    }
  }

  async function logoutSession() {
    try {
      await account.deleteSession({ sessionId: 'current' });
    } catch (_) {}
    sessionStorage.removeItem('autocareRole');
    sessionStorage.removeItem('autocareEmail');
    sessionStorage.removeItem('autocareName');
    window.location.href = 'autocare-landing.html';
  }

  async function deleteAutoCareAccount() {
    try {
      const jwt = await account.createJWT();
      const execution = await functions.createExecution({
        functionId: EMAIL_FUNCTION_ID,
        body: JSON.stringify({ action: 'delete-account' }),
        async: false,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-autocare-user-jwt': jwt.jwt
        }
      });
      if (execution.responseStatusCode >= 400) {
        let response = {};
        try { response = JSON.parse(execution.responseBody || '{}'); } catch (_) {}
        const deletionError = new Error(response.error || 'No fue posible eliminar la cuenta.');
        deletionError.deletionCode = response.code || '';
        throw deletionError;
      }
      [
        'autocareUserProfile',
        'autocareProfileOwner',
        'autocareOrientations',
        'autocareAgenda',
        'autocarePieceRequests',
        'autocarePaymentHistory',
        'autocareNotifications'
      ].forEach(key => localStorage.removeItem(key));
      const deletedEmail = (sessionStorage.getItem('autocareEmail') || '').trim().toLowerCase();
      if (deletedEmail) localStorage.removeItem(`autocareChatHistory_${deletedEmail}`);
      sessionStorage.removeItem('autocareRole');
      sessionStorage.removeItem('autocareEmail');
      sessionStorage.removeItem('autocareName');
      window.location.replace('autocare-landing.html?account=deleted');
    } catch (error) {
      clearBusy();
      const deletionMessages = {
        DELETE_KEY_MISSING: 'La función de eliminación no tiene configurada su clave segura.',
        DELETE_SCOPE_MISSING: 'La función no tiene permiso para eliminar usuarios.',
        DELETE_AUTH_REQUIRED: 'La sesión venció. Inicia sesión nuevamente antes de borrar la cuenta.',
        DELETE_SERVICE_UNAVAILABLE: 'No fue posible conectar con el servicio de cuentas. Inténtalo nuevamente.'
      };
      toast('❌', deletionMessages[error.deletionCode] || error.message || messageFor(error));
      const button = document.getElementById('confirmDeleteAccountBtn');
      if (button) {
        button.disabled = false;
        button.textContent = 'Borrar definitivamente';
      }
    }
  }

  async function bootstrapPrototype() {
    try {
      const user = await account.get();
      const role = await resolveRole(user);
      saveBrowserSession(user, role);
      if (typeof window.AutoCareData?.hydrateUserData === 'function') {
        try {
          await window.AutoCareData.hydrateUserData(role);
        } catch (error) {
          window.AutoCareData.reportSyncError('los datos de la cuenta', error);
        }
      }
      if (typeof window.applyRoleSession === 'function') window.applyRoleSession(role);
    } catch (_) {
      sessionStorage.clear();
      window.location.replace('autocare-landing.html');
    }
  }

  window.startSession = startSession;
  window.registerSession = registerSession;
  window.showPasswordRecovery = showPasswordRecovery;
  window.sendPasswordRecovery = sendPasswordRecovery;
  window.completePasswordRecovery = completePasswordRecovery;
  window.deleteAutoCareAccount = deleteAutoCareAccount;
  window.verifyRealTotpSetup = verifyRealTotpSetup;
  window.verifyRealMfaChallenge = verifyRealMfaChallenge;
  window.logoutSession = logoutSession;
  window.AutoCareAuth = {
    account,
    client,
    functions,
    bootstrapPrototype,
    sendEmail: sendTransactionalEmail,
    execute: executeBackendAction,
    config: CONFIG
  };

  const recoveryParams = new URLSearchParams(window.location.search);
  if (recoveryParams.get('userId') && recoveryParams.get('secret')) {
    showPasswordReset(
      recoveryParams.get('userId'),
      recoveryParams.get('secret'),
      recoveryParams.get('role') || 'user'
    );
  }
})();
