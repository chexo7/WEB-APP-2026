"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { get, onValue, push, ref, remove, set, update } from "firebase/database";
import { getFirebaseAuth, getFirebaseDatabase } from "@/lib/firebase";

const defaultCredentials = {
  email: "ssfamiliausa@gmail.com",
  password: "",
};

const defaultEntry = {
  type: "expense",
  description: "",
  amount: "",
};

export default function HomePage() {
  const [credentials, setCredentials] = useState(defaultCredentials);
  const [authState, setAuthState] = useState("checking");
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState(null);
  const [entryForm, setEntryForm] = useState(defaultEntry);
  const [snapshots, setSnapshots] = useState({});
  const [activeDate, setActiveDate] = useState("");
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
      setSnapshots({});
      setActiveDate("");
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

          if (!currentData.profile) {
            patch.profile = createUserProfile(user);
          }

          if (!currentData.cashflowSnapshots || !Object.keys(currentData.cashflowSnapshots).length) {
            patch.cashflowSnapshots = {
              [today]: createEmptySnapshot(today),
            };
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
        const nextSnapshots = snapshot.val() ?? {};
        const dates = Object.keys(nextSnapshots).sort();
        const latestDate = dates[dates.length - 1] ?? "";

        setSnapshots(nextSnapshots);
        setActiveDate((current) => (current && nextSnapshots[current] ? current : latestDate));
        setDataError("");
      },
      (firebaseError) => {
        setDataError(firebaseError.message);
      },
    );
  }, [user?.uid]);

  const orderedDates = useMemo(() => Object.keys(snapshots).sort().reverse(), [snapshots]);
  const currentDate = activeDate || orderedDates[0] || formatSnapshotDate(new Date());
  const currentSnapshot = snapshots[currentDate] ?? createEmptySnapshot(currentDate);
  const entries = Object.entries(currentSnapshot.entries ?? {})
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const totals = entries.reduce(
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

  const handleEntryChange = (event) => {
    const { name, value } = event.target;
    setEntryForm((current) => ({ ...current, [name]: value }));
  };

  const handleAddEntry = async (event) => {
    event.preventDefault();

    if (!user?.uid) {
      return;
    }

    const amount = Number(entryForm.amount);

    if (!entryForm.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      setDataError("Ingresa una descripcion y un monto valido.");
      return;
    }

    setSaveState("saving");
    setDataError("");

    try {
      const database = getFirebaseDatabase();
      const snapshotDate = formatSnapshotDate(new Date());
      const snapshotRef = ref(database, `users/${user.uid}/cashflowSnapshots/${snapshotDate}`);
      const existingSnapshot = await get(snapshotRef);

      if (!existingSnapshot.exists()) {
        const latestBackupDate = orderedDates.length ? orderedDates[0] : "";
        const latestBackup = latestBackupDate ? snapshots[latestBackupDate] : null;

        await set(snapshotRef, latestBackup ? cloneSnapshot(latestBackup, snapshotDate) : createEmptySnapshot(snapshotDate));
      }

      const entriesRef = ref(database, `users/${user.uid}/cashflowSnapshots/${snapshotDate}/entries`);
      const newEntryRef = push(entriesRef);

      await set(newEntryRef, {
        type: entryForm.type,
        description: entryForm.description.trim(),
        amount,
        createdAt: Date.now(),
      });

      setEntryForm(defaultEntry);
      setActiveDate(snapshotDate);
      setSaveState("saved");
    } catch (firebaseError) {
      setSaveState("error");
      setDataError(firebaseError.message);
    }
  };

  const handleRemoveEntry = async (entryId) => {
    if (!user?.uid || !currentDate) {
      return;
    }

    setSaveState("saving");
    setDataError("");

    try {
      const database = getFirebaseDatabase();
      const entryRef = ref(database, `users/${user.uid}/cashflowSnapshots/${currentDate}/entries/${entryId}`);
      await remove(entryRef);
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
          <h1>Snapshot activo: {currentDate}</h1>
          <p className="muted-text">
            La web lee automaticamente el ultimo snapshot y conserva los anteriores como respaldo.
          </p>
        </div>

        <div className="topbar-actions">
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
        <form className="panel-card entry-form" onSubmit={handleAddEntry}>
          <div className="panel-heading">
            <h2>Nuevo movimiento</h2>
            <p>Se guardara en el snapshot de hoy. Si hoy no existe, se crea copiando el ultimo snapshot.</p>
          </div>

          <label>
            Tipo
            <select name="type" onChange={handleEntryChange} value={entryForm.type}>
              <option value="income">Ingreso</option>
              <option value="expense">Gasto</option>
            </select>
          </label>

          <label>
            Descripcion
            <input
              name="description"
              onChange={handleEntryChange}
              placeholder="Ejemplo: pago cliente o compra de insumos"
              value={entryForm.description}
            />
          </label>

          <label>
            Monto
            <input
              inputMode="decimal"
              name="amount"
              onChange={handleEntryChange}
              placeholder="0"
              value={entryForm.amount}
            />
          </label>

          <button className="primary-button" disabled={saveState === "saving"} type="submit">
            {saveState === "saving" ? "Guardando..." : "Agregar movimiento"}
          </button>

          {dataError ? <p className="error-text">{dataError}</p> : null}
        </form>

        <section className="panel-card">
          <div className="panel-heading">
            <h2>Respaldos</h2>
            <p>Selecciona cualquier fecha para revisar una copia anterior.</p>
          </div>

          <div className="snapshot-list">
            {orderedDates.length ? (
              orderedDates.map((date) => (
                <button
                  className={date === currentDate ? "snapshot-button active" : "snapshot-button"}
                  key={date}
                  onClick={() => setActiveDate(date)}
                  type="button"
                >
                  {date}
                </button>
              ))
            ) : (
              <p className="muted-text">Aun no hay snapshots guardados.</p>
            )}
          </div>
        </section>
      </section>

      <section className="panel-card">
        <div className="panel-heading">
          <h2>Movimientos</h2>
          <p>Mostrando {entries.length} registros del snapshot {currentDate}.</p>
        </div>

        <div className="entry-list">
          {entries.length ? (
            entries.map((entry) => (
              <article className="entry-row" key={entry.id}>
                <div>
                  <span className={entry.type === "income" ? "type-pill income" : "type-pill expense"}>
                    {entry.type === "income" ? "Ingreso" : "Gasto"}
                  </span>
                  <strong>{entry.description}</strong>
                  <p>{formatDateTime(entry.createdAt)}</p>
                </div>

                <div className="entry-actions">
                  <strong>{formatCurrency(entry.amount)}</strong>
                  <button className="danger-button" onClick={() => handleRemoveEntry(entry.id)} type="button">
                    Quitar
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="muted-text">Este snapshot no tiene movimientos todavia.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function createEmptySnapshot(date) {
  return {
    date,
    createdAt: Date.now(),
    entries: {},
  };
}

function createInitialUserData(user, date) {
  return {
    profile: createUserProfile(user),
    cashflowSnapshots: {
      [date]: createEmptySnapshot(date),
    },
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

function cloneSnapshot(snapshot, date) {
  return {
    ...snapshot,
    date,
    clonedFrom: snapshot.date ?? null,
    clonedAt: Date.now(),
    entries: snapshot.entries ?? {},
  };
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
