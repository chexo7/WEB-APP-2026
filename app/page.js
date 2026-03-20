"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { get, onValue, push, ref, set, update } from "firebase/database";
import { getFirebaseAuth, getFirebaseDatabase } from "@/lib/firebase";

const defaultCredentials = {
  email: "ssfamiliausa@gmail.com",
  password: "",
};

const defaultNewEntry = {
  type: "expense",
  description: "",
  amount: "",
};

export default function HomePage() {
  const [credentials, setCredentials] = useState(defaultCredentials);
  const [authState, setAuthState] = useState("checking");
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState(null);
  const [snapshotTree, setSnapshotTree] = useState({});
  const [selectedVersionKey, setSelectedVersionKey] = useState("");
  const [loadedVersionKey, setLoadedVersionKey] = useState("");
  const [draftEntries, setDraftEntries] = useState({});
  const [newEntry, setNewEntry] = useState(defaultNewEntry);
  const [isInitializing, setIsInitializing] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [dataError, setDataError] = useState("");

  useEffect(() => {
    const auth = getFirebaseAuth();

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthState(nextUser ? "authenticated" : "anonymous");
      setAuthError("");
    });
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setSnapshotTree({});
      setSelectedVersionKey("");
      setLoadedVersionKey("");
      setDraftEntries({});
      setIsInitializing(false);
      return;
    }

    let isMounted = true;

    const initializeUserData = async () => {
      setIsInitializing(true);

      try {
        const database = getFirebaseDatabase();
        const userRef = ref(database, `users/${user.uid}`);
        const userSnapshot = await get(userRef);
        const today = formatSnapshotDate(new Date());

        if (!userSnapshot.exists()) {
          await set(userRef, createInitialUserData(user, today));
        } else {
          const currentData = userSnapshot.val() ?? {};
          const patch = {};
          const existingSnapshots = currentData.cashflowSnapshots ?? {};

          if (!currentData.profile) {
            patch.profile = createUserProfile(user);
          }

          if (!Object.keys(existingSnapshots).length) {
            patch[`cashflowSnapshots/${today}`] = createSnapshotContainer(user, today, {});
          }

          for (const [snapshotDate, snapshotValue] of Object.entries(existingSnapshots)) {
            if (!snapshotValue?.versions) {
              patch[`cashflowSnapshots/${snapshotDate}`] = createSnapshotContainer(
                user,
                snapshotDate,
                snapshotValue?.entries ?? {},
                snapshotValue?.createdAt,
              );
            } else if (!Object.keys(snapshotValue.versions).length) {
              const versionRef = ref(
                database,
                `users/${user.uid}/cashflowSnapshots/${snapshotDate}/versions`,
              );
              const versionId = push(versionRef).key;

              patch[`cashflowSnapshots/${snapshotDate}/versions/${versionId}`] = createSnapshotVersion({
                snapshotDate,
                entries: {},
                user,
                savedAt: Date.now(),
              });
            }
          }

          if (Object.keys(patch).length) {
            await update(userRef, patch);
          }
        }
      } catch (firebaseError) {
        if (isMounted) {
          setDataError(firebaseError.message);
        }
      } finally {
        if (isMounted) {
          setIsInitializing(false);
        }
      }
    };

    initializeUserData();

    return () => {
      isMounted = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    const database = getFirebaseDatabase();
    const snapshotsRef = ref(database, `users/${user.uid}/cashflowSnapshots`);

    return onValue(
      snapshotsRef,
      (snapshot) => {
        setSnapshotTree(snapshot.val() ?? {});
        setDataError("");
      },
      (firebaseError) => {
        setDataError(firebaseError.message);
      },
    );
  }, [user?.uid]);

  const recentVersions = useMemo(() => extractRecentVersions(snapshotTree, 5), [snapshotTree]);

  useEffect(() => {
    if (!recentVersions.length) {
      setSelectedVersionKey("");
      setLoadedVersionKey("");
      setDraftEntries({});
      return;
    }

    const nextSelectedKey = recentVersions.some((version) => version.key === selectedVersionKey)
      ? selectedVersionKey
      : recentVersions[0].key;

    if (nextSelectedKey !== selectedVersionKey) {
      setSelectedVersionKey(nextSelectedKey);
      return;
    }

    if (loadedVersionKey !== nextSelectedKey) {
      const nextVersion = recentVersions.find((version) => version.key === nextSelectedKey);
      setDraftEntries(cloneEntries(nextVersion?.entries));
      setLoadedVersionKey(nextSelectedKey);
      setSaveState("idle");
      setDataError("");
    }
  }, [loadedVersionKey, recentVersions, selectedVersionKey]);

  const selectedVersion =
    recentVersions.find((version) => version.key === selectedVersionKey) ?? recentVersions[0] ?? null;

  const draftList = useMemo(() => {
    return Object.entries(draftEntries)
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [draftEntries]);

  const totals = draftList.reduce(
    (accumulator, item) => {
      if (item.type === "income") {
        accumulator.income += Number(item.amount) || 0;
      } else {
        accumulator.expense += Number(item.amount) || 0;
      }

      return accumulator;
    },
    { income: 0, expense: 0 },
  );

  const balance = totals.income - totals.expense;

  const handleCredentialsChange = (event) => {
    const { name, value } = event.target;
    setCredentials((current) => ({ ...current, [name]: value }));
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthState("loading");

    try {
      const auth = getFirebaseAuth();
      await signInWithEmailAndPassword(auth, credentials.email.trim(), credentials.password);
    } catch (firebaseError) {
      setAuthState("anonymous");
      setAuthError(firebaseError.message);
    }
  };

  const handleLogout = async () => {
    setAuthError("");

    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
    } catch (firebaseError) {
      setAuthError(firebaseError.message);
    }
  };

  const handleNewEntryChange = (event) => {
    const { name, value } = event.target;
    setNewEntry((current) => ({ ...current, [name]: value }));
    setDataError("");
  };

  const handleAddDraftEntry = (event) => {
    event.preventDefault();

    const amount = Number(newEntry.amount);

    if (!newEntry.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      setDataError("Ingresa una descripcion y un monto valido para el borrador.");
      return;
    }

    const entryId = createDraftEntryId();

    setDraftEntries((current) => ({
      ...current,
      [entryId]: {
        type: newEntry.type,
        description: newEntry.description.trim(),
        amount,
        createdAt: Date.now(),
      },
    }));

    setNewEntry(defaultNewEntry);
    setSaveState("idle");
    setDataError("");
  };

  const handleDraftEntryChange = (entryId, field, value) => {
    setDraftEntries((current) => ({
      ...current,
      [entryId]: {
        ...current[entryId],
        [field]: field === "amount" ? value : value,
      },
    }));

    setSaveState("idle");
    setDataError("");
  };

  const handleRemoveDraftEntry = (entryId) => {
    setDraftEntries((current) => {
      const nextEntries = { ...current };
      delete nextEntries[entryId];
      return nextEntries;
    });

    setSaveState("idle");
    setDataError("");
  };

  const handleResetDraft = () => {
    setDraftEntries(cloneEntries(selectedVersion?.entries));
    setSaveState("idle");
    setDataError("");
  };

  const handleSaveSnapshot = async () => {
    if (!user?.uid) {
      return;
    }

    const sanitizedEntries = sanitizeEntries(draftEntries);
    const validationError = validateEntries(sanitizedEntries);

    if (validationError) {
      setDataError(validationError);
      return;
    }

    setSaveState("saving");
    setDataError("");

    try {
      const database = getFirebaseDatabase();
      const snapshotDate = formatSnapshotDate(new Date());
      const versionsRef = ref(database, `users/${user.uid}/cashflowSnapshots/${snapshotDate}/versions`);
      const newVersionRef = push(versionsRef);

      await set(
        newVersionRef,
        createSnapshotVersion({
          snapshotDate,
          entries: sanitizedEntries,
          user,
          sourceVersion: selectedVersion,
          savedAt: Date.now(),
        }),
      );

      setSelectedVersionKey(buildVersionKey(snapshotDate, newVersionRef.key));
      setLoadedVersionKey("");
      setSaveState("saved");
    } catch (firebaseError) {
      setSaveState("error");
      setDataError(firebaseError.message);
    }
  };

  if (authState !== "authenticated") {
    return (
      <main className="login-shell">
        <section className="login-card">
          <form className="login-form" onSubmit={handleLogin}>
            <h1>Acceso</h1>

            <label>
              Usuario
              <input
                autoComplete="email"
                name="email"
                onChange={handleCredentialsChange}
                type="email"
                value={credentials.email}
              />
            </label>

            <label>
              Contrasena
              <input
                autoComplete="current-password"
                name="password"
                onChange={handleCredentialsChange}
                type="password"
                value={credentials.password}
              />
            </label>

            <button className="primary-button" disabled={authState === "loading"} type="submit">
              {authState === "loading" ? "Entrando..." : "Entrar"}
            </button>

            {authError ? <p className="error-text">{authError}</p> : null}
          </form>
        </section>
      </main>
    );
  }

  if (isInitializing) {
    return (
      <main className="login-shell">
        <section className="login-card loading-card">
          <h1>Preparando base de datos</h1>
          <p className="muted-text">Creando la estructura inicial minima para empezar a trabajar.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Flujo de caja</p>
          <h1>Editor con guardado por versiones</h1>
          <p className="muted-text">
            Editas el borrador libremente y solo se guarda una nueva entrada cuando confirmas.
          </p>
        </div>

        <div className="topbar-actions">
          <label className="history-control">
            Ultimas 5 entradas
            <select onChange={(event) => setSelectedVersionKey(event.target.value)} value={selectedVersionKey}>
              {recentVersions.map((version) => (
                <option key={version.key} value={version.key}>
                  {formatVersionLabel(version)}
                </option>
              ))}
            </select>
          </label>

          <span className="user-chip">{user?.email}</span>

          <button className="secondary-button" onClick={handleLogout} type="button">
            Cerrar sesion
          </button>
        </div>
      </section>

      <section className="summary-grid">
        <article className="summary-card">
          <span>Ingresos</span>
          <strong>{formatCurrency(totals.income)}</strong>
        </article>
        <article className="summary-card">
          <span>Gastos</span>
          <strong>{formatCurrency(totals.expense)}</strong>
        </article>
        <article className="summary-card">
          <span>Saldo</span>
          <strong>{formatCurrency(balance)}</strong>
        </article>
      </section>

      <section className="workspace-grid">
        <form className="panel-card entry-form" onSubmit={handleAddDraftEntry}>
          <div className="panel-heading">
            <h2>Agregar al borrador</h2>
            <p>Este movimiento solo se agrega localmente. No toca la base hasta que guardes.</p>
          </div>

          <label>
            Tipo
            <select name="type" onChange={handleNewEntryChange} value={newEntry.type}>
              <option value="income">Ingreso</option>
              <option value="expense">Gasto</option>
            </select>
          </label>

          <label>
            Descripcion
            <input
              name="description"
              onChange={handleNewEntryChange}
              placeholder="Ejemplo: pago cliente o compra"
              value={newEntry.description}
            />
          </label>

          <label>
            Monto
            <input
              inputMode="decimal"
              name="amount"
              onChange={handleNewEntryChange}
              placeholder="0"
              value={newEntry.amount}
            />
          </label>

          <button className="primary-button" type="submit">
            Agregar al borrador
          </button>
        </form>

        <section className="panel-card">
          <div className="panel-heading">
            <h2>Version seleccionada</h2>
            <p>
              Base cargada:{" "}
              <strong>{selectedVersion ? formatVersionLabel(selectedVersion) : "Sin historial disponible"}</strong>
            </p>
          </div>

          <div className="button-row">
            <button className="secondary-button" onClick={handleResetDraft} type="button">
              Descartar cambios
            </button>
            <button
              className="primary-button"
              disabled={saveState === "saving"}
              onClick={handleSaveSnapshot}
              type="button"
            >
              {saveState === "saving" ? "Guardando..." : "Guardar como nueva entrada"}
            </button>
          </div>

          {saveState === "saved" ? <p className="success-text">Nueva entrada guardada correctamente.</p> : null}
          {dataError ? <p className="error-text">{dataError}</p> : null}
        </section>
      </section>

      <section className="panel-card">
        <div className="panel-heading">
          <h2>Borrador actual</h2>
          <p>Puedes editar cada fila libremente antes de guardar una nueva version.</p>
        </div>

        <div className="editor-list">
          {draftList.length ? (
            draftList.map((entry) => (
              <article className="editor-row" key={entry.id}>
                <select
                  onChange={(event) => handleDraftEntryChange(entry.id, "type", event.target.value)}
                  value={entry.type ?? "expense"}
                >
                  <option value="income">Ingreso</option>
                  <option value="expense">Gasto</option>
                </select>

                <input
                  onChange={(event) => handleDraftEntryChange(entry.id, "description", event.target.value)}
                  value={entry.description ?? ""}
                />

                <input
                  inputMode="decimal"
                  onChange={(event) => handleDraftEntryChange(entry.id, "amount", event.target.value)}
                  value={entry.amount ?? ""}
                />

                <button className="danger-button" onClick={() => handleRemoveDraftEntry(entry.id)} type="button">
                  Quitar
                </button>
              </article>
            ))
          ) : (
            <p className="muted-text">No hay movimientos en el borrador.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function createInitialUserData(user, snapshotDate) {
  return {
    profile: createUserProfile(user),
    cashflowSnapshots: {
      [snapshotDate]: createSnapshotContainer(user, snapshotDate, {}),
    },
  };
}

function createSnapshotContainer(user, snapshotDate, entries, savedAt = Date.now()) {
  const versionId = createDraftEntryId();

  return {
    versions: {
      [versionId]: createSnapshotVersion({
        snapshotDate,
        entries,
        user,
        savedAt,
      }),
    },
  };
}

function createSnapshotVersion({ snapshotDate, entries, user, sourceVersion, savedAt }) {
  return {
    snapshotDate,
    savedAt,
    createdByUid: user?.uid ?? "",
    createdByEmail: user?.email ?? "",
    sourceSnapshotDate: sourceVersion?.snapshotDate ?? null,
    sourceVersionId: sourceVersion?.versionId ?? null,
    entries: sanitizeEntries(entries),
  };
}

function createUserProfile(user) {
  return {
    uid: user.uid,
    email: user.email ?? "",
    currency: "USD",
    createdAt: Date.now(),
  };
}

function createDraftEntryId() {
  return `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneEntries(entries = {}) {
  return Object.fromEntries(
    Object.entries(entries).map(([entryId, value]) => [
      entryId,
      {
        ...value,
      },
    ]),
  );
}

function sanitizeEntries(entries = {}) {
  return Object.fromEntries(
    Object.entries(entries).map(([entryId, value]) => [
      entryId,
      {
        type: value?.type === "income" ? "income" : "expense",
        description: String(value?.description ?? "").trim(),
        amount: Number(value?.amount) || 0,
        createdAt: Number(value?.createdAt) || Date.now(),
      },
    ]),
  );
}

function validateEntries(entries = {}) {
  for (const value of Object.values(entries)) {
    if (!String(value?.description ?? "").trim()) {
      return "Todas las filas deben tener descripcion antes de guardar.";
    }

    if (!Number.isFinite(Number(value?.amount)) || Number(value?.amount) <= 0) {
      return "Todos los movimientos deben tener un monto mayor que cero.";
    }
  }

  return "";
}

function extractRecentVersions(snapshotTree, limit) {
  const versions = [];

  for (const [snapshotDate, snapshotValue] of Object.entries(snapshotTree ?? {})) {
    if (snapshotValue?.versions) {
      for (const [versionId, version] of Object.entries(snapshotValue.versions)) {
        versions.push({
          key: buildVersionKey(snapshotDate, versionId),
          snapshotDate,
          versionId,
          savedAt: Number(version?.savedAt) || 0,
          entries: version?.entries ?? {},
        });
      }
    } else if (snapshotValue) {
      versions.push({
        key: buildVersionKey(snapshotDate, `legacy_${snapshotValue.createdAt ?? 0}`),
        snapshotDate,
        versionId: `legacy_${snapshotValue.createdAt ?? 0}`,
        savedAt: Number(snapshotValue?.createdAt) || 0,
        entries: snapshotValue?.entries ?? {},
      });
    }
  }

  return versions
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
    .slice(0, limit);
}

function buildVersionKey(snapshotDate, versionId) {
  return `${snapshotDate}__${versionId}`;
}

function formatSnapshotDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatVersionLabel(version) {
  return `${version.snapshotDate} | ${formatDateTime(version.savedAt)}`;
}
