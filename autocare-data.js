(function () {
  'use strict';

  const DATABASE_ID = '6a7f5e6e003c03fa340d';
  const TABLES = Object.freeze({
    profiles: 'profiles',
    vehicles: 'vehicles',
    appointments: 'appointments'
  });

  if (!window.Appwrite || !window.AutoCareAuth?.client || !window.Appwrite.TablesDB) {
    console.warn('AutoCare Data: TablesDB no está disponible; se conserva el modo local.');
    return;
  }

  const tablesDB = new Appwrite.TablesDB(window.AutoCareAuth.client);

  async function user() {
    return window.AutoCareAuth.account.get();
  }

  function ownerPermissions(userId) {
    const owner = Appwrite.Role.user(userId);
    return [
      Appwrite.Permission.read(owner),
      Appwrite.Permission.update(owner),
      Appwrite.Permission.delete(owner)
    ];
  }

  function parsePayload(row, fallback = {}) {
    try {
      return { ...fallback, ...JSON.parse(row?.payload || '{}'), cloudId: row?.$id };
    } catch (_) {
      return { ...fallback, cloudId: row?.$id };
    }
  }

  async function saveProfile(profile) {
    const current = await user();
    const safeProfile = { ...profile };
    delete safeProfile.cardNumber;
    delete safeProfile.cardName;
    delete safeProfile.cardExpiry;
    delete safeProfile.cards;
    const requestedName = String(safeProfile.fullName || '').trim();
    if (requestedName && requestedName !== String(current.name || '').trim()) {
      await window.AutoCareAuth.account.updateName({ name: requestedName });
      sessionStorage.setItem('autocareName', requestedName);
    }
    return tablesDB.upsertRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.profiles,
      rowId: current.$id,
      data: { payload: JSON.stringify(safeProfile) },
      permissions: ownerPermissions(current.$id)
    });
  }

  async function loadProfile() {
    const current = await user();
    try {
      const row = await tablesDB.getRow({
        databaseId: DATABASE_ID,
        tableId: TABLES.profiles,
        rowId: current.$id
      });
      return parsePayload(row);
    } catch (error) {
      if (error?.code === 404) return null;
      throw error;
    }
  }

  async function saveVehicles(vehicles) {
    const current = await user();
    const existing = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.vehicles,
      total: false
    });

    await Promise.all((existing.rows || []).map(row => tablesDB.deleteRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.vehicles,
      rowId: row.$id
    })));

    return Promise.all((vehicles || []).map(vehicle => tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.vehicles,
      rowId: Appwrite.ID.unique(),
      data: { ownerId: current.$id, payload: JSON.stringify(vehicle) },
      permissions: ownerPermissions(current.$id)
    })));
  }

  async function loadVehicles() {
    const current = await user();
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.vehicles,
      total: false
    });
    return (result.rows || []).map(row => parsePayload(row));
  }

  async function saveAppointment(appointment) {
    const current = await user();
    const workshopId = appointment.workshopId || String(appointment.taller || 'autopro')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36);
    return tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.appointments,
      rowId: Appwrite.ID.unique(),
      data: {
        userId: current.$id,
        workshopId,
        payload: JSON.stringify(appointment)
      },
      permissions: ownerPermissions(current.$id)
    });
  }

  async function updateAppointment(appointment) {
    if (!appointment?.cloudId) return null;
    const current = await user();
    const workshopId = appointment.workshopId || String(appointment.taller || 'autopro')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36);
    return tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.appointments,
      rowId: appointment.cloudId,
      data: {
        userId: current.$id,
        workshopId,
        payload: JSON.stringify({ ...appointment, cloudId: undefined })
      }
    });
  }

  async function loadAppointments() {
    const current = await user();
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.appointments,
      total: false
    });
    return (result.rows || []).map(row => parsePayload(row));
  }

  async function loadWorkshopAppointments() {
    if (typeof window.AutoCareAuth?.execute !== 'function') return [];
    const result = await window.AutoCareAuth.execute('list-workshop-appointments');
    const appointments = Array.isArray(result.appointments) ? result.appointments : [];
    localStorage.setItem('autocareAgenda', JSON.stringify(appointments));
    return appointments;
  }

  async function updateWorkshopAppointment(appointment, status, reason = '') {
    if (!appointment?.cloudId || typeof window.AutoCareAuth?.execute !== 'function') return null;
    const result = await window.AutoCareAuth.execute('update-workshop-appointment', {
      cloudId:appointment.cloudId,
      status,
      reason
    });
    return result;
  }

  async function hydrateUserData(role) {
    if (role === 'shop') {
      await loadWorkshopAppointments();
      return;
    }
    if (role !== 'user') return;
    const localProfile = (() => {
      try { return JSON.parse(localStorage.getItem('autocareUserProfile') || 'null'); }
      catch (_) { return null; }
    })();

    const [cloudProfile, cloudVehicles, cloudAppointments] = await Promise.all([
      loadProfile(),
      loadVehicles(),
      loadAppointments()
    ]);

    if (cloudProfile) {
      const localPaymentData = localProfile ? {
        cards: localProfile.cards,
        cardNumber: localProfile.cardNumber,
        cardName: localProfile.cardName,
        cardExpiry: localProfile.cardExpiry
      } : {};
      localStorage.setItem('autocareUserProfile', JSON.stringify({
        ...(localProfile || {}),
        ...cloudProfile,
        ...localPaymentData,
        vehicles: cloudVehicles.length ? cloudVehicles : (localProfile?.vehicles || [])
      }));
    } else if (localProfile) {
      await saveProfile(localProfile);
      if (Array.isArray(localProfile.vehicles) && localProfile.vehicles.length && !cloudVehicles.length) {
        await saveVehicles(localProfile.vehicles);
      }
    }

    if (cloudAppointments.length) {
      localStorage.setItem('autocareAgenda', JSON.stringify(cloudAppointments));
    }
    if (typeof window.syncAppointmentNotifications === 'function') {
      window.syncAppointmentNotifications(cloudAppointments);
    }
  }

  function reportSyncError(scope, error) {
    console.warn(`AutoCare Data: no se pudo sincronizar ${scope}; se conservó la copia local.`, error);
  }

  window.AutoCareData = {
    tablesDB,
    config: { databaseId: DATABASE_ID, tables: TABLES },
    saveProfile,
    loadProfile,
    saveVehicles,
    loadVehicles,
    saveAppointment,
    updateAppointment,
    loadAppointments,
    loadWorkshopAppointments,
    updateWorkshopAppointment,
    hydrateUserData,
    reportSyncError
  };
})();
