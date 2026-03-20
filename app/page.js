"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { get, onValue, push, ref, set } from "firebase/database";
import { getFirebaseAuth, getFirebaseDatabase } from "@/lib/firebase";

const defaultCredentials = { email: "ssfamiliausa@gmail.com", password: "" };
const tabs = [
  { id: "expenses", label: "Gastos" },
  { id: "incomes", label: "Ingresos" },
  { id: "cashflow", label: "Flujo de caja" },
  { id: "charts", label: "Graficos" },
];

export default function HomePage() {
  const [credentials, setCredentials] = useState(defaultCredentials);
  const [authState, setAuthState] = useState("checking");
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("expenses");
  const [snapshotTree, setSnapshotTree] = useState({});
  const [selectedVersionKey, setSelectedVersionKey] = useState("");
  const [loadedVersionKey, setLoadedVersionKey] = useState("");
  const [draft, setDraft] = useState(emptyWorkspace());
  const [expenseForm, setExpenseForm] = useState(defaultExpenseForm());
  const [incomeForm, setIncomeForm] = useState(defaultIncomeForm());
  const [editingExpenseId, setEditingExpenseId] = useState("");
  const [editingIncomeId, setEditingIncomeId] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [dataError, setDataError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

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
      setDraft(emptyWorkspace());
      setIsInitializing(false);
      return;
    }

    let active = true;

    const initialize = async () => {
      setIsInitializing(true);

      try {
        const database = getFirebaseDatabase();
        const userRef = ref(database, `users/${user.uid}`);
        const userSnapshot = await get(userRef);

        if (!userSnapshot.exists()) {
          await set(userRef, createInitialUserData(user, localDate()));
        } else {
          const currentData = userSnapshot.val() ?? {};
          const today = localDate();

          if (!currentData.profile) {
            await set(ref(database, `users/${user.uid}/profile`), createUserProfile(user));
          }

          if (!currentData.cashflowSnapshots || !Object.keys(currentData.cashflowSnapshots).length) {
            await set(
              ref(database, `users/${user.uid}/cashflowSnapshots/${today}`),
              createInitialUserData(user, today).cashflowSnapshots[today],
            );
          }
        }
      } catch (firebaseError) {
        if (active) {
          setDataError(firebaseError.message);
        }
      } finally {
        if (active) {
          setIsInitializing(false);
        }
      }
    };

    initialize();

    return () => {
      active = false;
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

  const recentVersions = useMemo(() => extractRecentVersions(snapshotTree).slice(0, 5), [snapshotTree]);

  useEffect(() => {
    if (!recentVersions.length) {
      setSelectedVersionKey("");
      setLoadedVersionKey("");
      setDraft(emptyWorkspace());
      return;
    }

    if (!selectedVersionKey) {
      setSelectedVersionKey(recentVersions[0].key);
      return;
    }

    const selectedVersion = recentVersions.find((version) => version.key === selectedVersionKey);

    if (selectedVersion && loadedVersionKey !== selectedVersionKey) {
      setDraft(normalizeWorkspace(selectedVersion.payload));
      setLoadedVersionKey(selectedVersionKey);
      setExpenseForm(defaultExpenseForm());
      setIncomeForm(defaultIncomeForm());
      setEditingExpenseId("");
      setEditingIncomeId("");
      setSaveState("idle");
      setDataError("");
      setSuccessMessage("");
    }
  }, [loadedVersionKey, recentVersions, selectedVersionKey]);

  const selectedVersion =
    recentVersions.find((version) => version.key === selectedVersionKey) ?? recentVersions[0] ?? null;

  const expenses = useMemo(
    () =>
      Object.entries(draft.expenses)
        .map(([id, value]) => ({ id, ...value }))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [draft.expenses],
  );

  const incomes = useMemo(
    () =>
      Object.entries(draft.incomes)
        .map(([id, value]) => ({ id, ...value }))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [draft.incomes],
  );

  const incomeTotal = incomes.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const expenseTotal = expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const balance = incomeTotal - expenseTotal;
  const hasUnsavedChanges = JSON.stringify(sanitizeWorkspace(draft)) !== JSON.stringify(sanitizeWorkspace(selectedVersion?.payload));

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
    try {
      const auth = getFirebaseAuth();
      await signOut(auth);
    } catch (firebaseError) {
      setAuthError(firebaseError.message);
    }
  };

  const saveExpenseToDraft = (event) => {
    event.preventDefault();
    const error = validateExpense(expenseForm);

    if (error) {
      setDataError(error);
      return;
    }

    const expenseId = editingExpenseId || localId("expense");

    setDraft((current) => ({
      ...current,
      expenses: {
        ...current.expenses,
        [expenseId]: {
          detail: expenseForm.detail.trim(),
          frequency: expenseForm.frequency.trim(),
          date: expenseForm.date,
          amount: Number(expenseForm.amount),
          currency: expenseForm.currency,
          merchantName: expenseForm.merchantName.trim(),
          recurrence: expenseForm.recurrence.trim(),
          createdAt: current.expenses?.[expenseId]?.createdAt ?? Date.now(),
        },
      },
    }));

    setExpenseForm(defaultExpenseForm());
    setEditingExpenseId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const saveIncomeToDraft = (event) => {
    event.preventDefault();
    const error = validateIncome(incomeForm);

    if (error) {
      setDataError(error);
      return;
    }

    const incomeId = editingIncomeId || localId("income");

    setDraft((current) => ({
      ...current,
      incomes: {
        ...current.incomes,
        [incomeId]: {
          name: incomeForm.name.trim(),
          amount: Number(incomeForm.amount),
          recurrence: incomeForm.recurrence.trim(),
          createdAt: current.incomes?.[incomeId]?.createdAt ?? Date.now(),
        },
      },
    }));

    setIncomeForm(defaultIncomeForm());
    setEditingIncomeId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const editExpense = (expenseId) => {
    const expense = draft.expenses[expenseId];
    if (!expense) return;

    setExpenseForm({
      detail: expense.detail ?? "",
      frequency: expense.frequency ?? "",
      date: expense.date ?? localDate(),
      amount: String(expense.amount ?? ""),
      currency: expense.currency ?? "CLP",
      merchantName: expense.merchantName ?? "",
      recurrence: expense.recurrence ?? "",
    });
    setEditingExpenseId(expenseId);
    setActiveTab("expenses");
  };

  const editIncome = (incomeId) => {
    const income = draft.incomes[incomeId];
    if (!income) return;

    setIncomeForm({
      name: income.name ?? "",
      amount: String(income.amount ?? ""),
      recurrence: income.recurrence ?? "",
    });
    setEditingIncomeId(incomeId);
    setActiveTab("incomes");
  };

  const deleteExpense = (expenseId) => {
    setDraft((current) => {
      const nextExpenses = { ...current.expenses };
      delete nextExpenses[expenseId];
      return { ...current, expenses: nextExpenses };
    });
    setSaveState("idle");
    setSuccessMessage("");
  };

  const deleteIncome = (incomeId) => {
    setDraft((current) => {
      const nextIncomes = { ...current.incomes };
      delete nextIncomes[incomeId];
      return { ...current, incomes: nextIncomes };
    });
    setSaveState("idle");
    setSuccessMessage("");
  };

  const discardChanges = () => {
    setDraft(normalizeWorkspace(selectedVersion?.payload));
    setExpenseForm(defaultExpenseForm());
    setIncomeForm(defaultIncomeForm());
    setEditingExpenseId("");
    setEditingIncomeId("");
    setSaveState("idle");
    setDataError("");
    setSuccessMessage("");
  };

  const saveVersion = async (sectionLabel) => {
    const sanitized = sanitizeWorkspace(draft);
    const error = validateWorkspace(sanitized);

    if (error || !user?.uid) {
      setDataError(error || "No hay sesion activa.");
      return;
    }

    setSaveState("saving");
    setDataError("");
    setSuccessMessage("");

    try {
      const database = getFirebaseDatabase();
      const snapshotDate = localDate();
      const versionsRef = ref(database, `users/${user.uid}/cashflowSnapshots/${snapshotDate}/versions`);
      const newVersionRef = push(versionsRef);
      const versionPayload = createVersionPayload(snapshotDate, sanitized, user, selectedVersion);

      await set(newVersionRef, versionPayload);

      setSnapshotTree((current) => ({
        ...current,
        [snapshotDate]: {
          ...(current[snapshotDate] ?? {}),
          versions: {
            ...(current[snapshotDate]?.versions ?? {}),
            [newVersionRef.key]: versionPayload,
          },
        },
      }));

      setSelectedVersionKey(buildKey(snapshotDate, newVersionRef.key));
      setLoadedVersionKey("");
      setSaveState("saved");
      setSuccessMessage(`La lista de ${sectionLabel} se guardo como nueva entrada.`);
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
                onChange={(event) => setCredentials((current) => ({ ...current, email: event.target.value }))}
                type="email"
                value={credentials.email}
              />
            </label>

            <label>
              Contrasena
              <input
                autoComplete="current-password"
                name="password"
                onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))}
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
          <p className="muted-text">Creando la estructura minima para la nueva interfaz.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Caja diaria</p>
          <h1>Panel principal</h1>
          <p className="muted-text">Editas libremente y la base solo cambia cuando tu guardas una nueva version.</p>
        </div>

        <div className="topbar-actions">
          <label className="history-control">
            Version cargada
            <select onChange={(event) => setSelectedVersionKey(event.target.value)} value={selectedVersionKey}>
              {recentVersions.map((version) => (
                <option key={version.key} value={version.key}>
                  {labelVersion(version)}
                </option>
              ))}
            </select>
          </label>

          <span className={hasUnsavedChanges ? "status-chip pending" : "status-chip"}>
            {hasUnsavedChanges ? "Cambios sin guardar" : "Sin cambios pendientes"}
          </span>

          <span className="user-chip">{user?.email}</span>

          <button className="secondary-button" onClick={handleLogout} type="button">
            Cerrar sesion
          </button>
        </div>
      </section>

      <section className="summary-grid">
        <article className="summary-card">
          <span>Ingresos</span>
          <strong>{money(incomeTotal, "USD")}</strong>
        </article>
        <article className="summary-card">
          <span>Gastos</span>
          <strong>{money(expenseTotal, "USD")}</strong>
        </article>
        <article className="summary-card">
          <span>Saldo</span>
          <strong>{money(balance, "USD")}</strong>
        </article>
      </section>

      <section className="tabs-card">
        <div className="tabs-bar" role="tablist" aria-label="Pestanas principales">
          {tabs.map((tab) => (
            <button
              className={activeTab === tab.id ? "tab-button active" : "tab-button"}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tab-panel">
          {activeTab === "expenses" ? (
            <section className="workspace-grid">
              <form className="panel-card entry-form" onSubmit={saveExpenseToDraft}>
                <div className="panel-heading">
                  <h2>{editingExpenseId ? "Modificar gasto" : "Ingresar gasto"}</h2>
                  <p>Datos, frecuencia, fecha, valor, moneda, comercio y recurrencia.</p>
                </div>

                <label>
                  Datos
                  <input name="detail" onChange={(e) => setExpenseForm((c) => ({ ...c, detail: e.target.value }))} value={expenseForm.detail} />
                </label>
                <label>
                  Frecuencia
                  <input name="frequency" onChange={(e) => setExpenseForm((c) => ({ ...c, frequency: e.target.value }))} value={expenseForm.frequency} />
                </label>
                <label>
                  Fecha
                  <input name="date" onChange={(e) => setExpenseForm((c) => ({ ...c, date: e.target.value }))} type="date" value={expenseForm.date} />
                </label>
                <label>
                  Valor
                  <input inputMode="decimal" name="amount" onChange={(e) => setExpenseForm((c) => ({ ...c, amount: e.target.value }))} value={expenseForm.amount} />
                </label>
                <label>
                  Moneda
                  <select name="currency" onChange={(e) => setExpenseForm((c) => ({ ...c, currency: e.target.value }))} value={expenseForm.currency}>
                    <option value="CLP">CLP</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
                <label>
                  Nombre del comercio
                  <input name="merchantName" onChange={(e) => setExpenseForm((c) => ({ ...c, merchantName: e.target.value }))} value={expenseForm.merchantName} />
                </label>
                <label>
                  Recurrencia
                  <input name="recurrence" onChange={(e) => setExpenseForm((c) => ({ ...c, recurrence: e.target.value }))} value={expenseForm.recurrence} />
                </label>

                <div className="button-row">
                  <button className="primary-button" type="submit">
                    {editingExpenseId ? "Actualizar gasto" : "Agregar gasto al borrador"}
                  </button>
                  <button className="secondary-button" onClick={() => { setExpenseForm(defaultExpenseForm()); setEditingExpenseId(""); }} type="button">
                    Limpiar
                  </button>
                </div>

                <div className="button-row">
                  <button className="secondary-button" onClick={discardChanges} type="button">
                    Descartar cambios
                  </button>
                  <button className="primary-button" disabled={saveState === "saving"} onClick={() => saveVersion("gastos")} type="button">
                    {saveState === "saving" ? "Guardando..." : "Guardar lista de gastos"}
                  </button>
                </div>

                {successMessage ? <p className="success-text">{successMessage}</p> : null}
                {dataError ? <p className="error-text">{dataError}</p> : null}
              </form>

              <section className="panel-card">
                <div className="panel-heading">
                  <h2>Lista de gastos</h2>
                  <p>Se pueden ver y modificar con su boton correspondiente.</p>
                </div>

                <div className="record-list">
                  {expenses.length ? (
                    expenses.map((expense) => (
                      <article className="record-row" key={expense.id}>
                        <div className="record-main">
                          <strong>{expense.merchantName || "Sin comercio"}</strong>
                          <p>{expense.detail || "Sin detalle"}</p>
                          <span>{expense.date} | {expense.frequency || "Sin frecuencia"} | {expense.recurrence || "Sin recurrencia"}</span>
                        </div>
                        <div className="record-side">
                          <strong>{money(expense.amount, expense.currency)}</strong>
                          <div className="record-actions">
                            <button className="secondary-button" onClick={() => editExpense(expense.id)} type="button">Modificar</button>
                            <button className="danger-button" onClick={() => deleteExpense(expense.id)} type="button">Quitar</button>
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="muted-text">Todavia no hay gastos en la lista.</p>
                  )}
                </div>
              </section>
            </section>
          ) : null}

          {activeTab === "incomes" ? (
            <section className="workspace-grid">
              <form className="panel-card entry-form" onSubmit={saveIncomeToDraft}>
                <div className="panel-heading">
                  <h2>{editingIncomeId ? "Modificar ingreso" : "Ingresar ingreso"}</h2>
                  <p>Valor, nombre y recurrencia para cada ingreso.</p>
                </div>

                <label>
                  Nombre
                  <input name="name" onChange={(e) => setIncomeForm((c) => ({ ...c, name: e.target.value }))} value={incomeForm.name} />
                </label>
                <label>
                  Valor
                  <input inputMode="decimal" name="amount" onChange={(e) => setIncomeForm((c) => ({ ...c, amount: e.target.value }))} value={incomeForm.amount} />
                </label>
                <label>
                  Recurrencia
                  <input name="recurrence" onChange={(e) => setIncomeForm((c) => ({ ...c, recurrence: e.target.value }))} value={incomeForm.recurrence} />
                </label>

                <div className="button-row">
                  <button className="primary-button" type="submit">
                    {editingIncomeId ? "Actualizar ingreso" : "Agregar ingreso al borrador"}
                  </button>
                  <button className="secondary-button" onClick={() => { setIncomeForm(defaultIncomeForm()); setEditingIncomeId(""); }} type="button">
                    Limpiar
                  </button>
                </div>

                <div className="button-row">
                  <button className="secondary-button" onClick={discardChanges} type="button">
                    Descartar cambios
                  </button>
                  <button className="primary-button" disabled={saveState === "saving"} onClick={() => saveVersion("ingresos")} type="button">
                    {saveState === "saving" ? "Guardando..." : "Guardar lista de ingresos"}
                  </button>
                </div>

                {successMessage ? <p className="success-text">{successMessage}</p> : null}
                {dataError ? <p className="error-text">{dataError}</p> : null}
              </form>

              <section className="panel-card">
                <div className="panel-heading">
                  <h2>Lista de ingresos</h2>
                  <p>Los ingresos tambien se pueden revisar y modificar desde aqui.</p>
                </div>

                <div className="record-list">
                  {incomes.length ? (
                    incomes.map((income) => (
                      <article className="record-row" key={income.id}>
                        <div className="record-main">
                          <strong>{income.name || "Sin nombre"}</strong>
                          <span>{income.recurrence || "Sin recurrencia"}</span>
                        </div>
                        <div className="record-side">
                          <strong>{money(income.amount, "USD")}</strong>
                          <div className="record-actions">
                            <button className="secondary-button" onClick={() => editIncome(income.id)} type="button">Modificar</button>
                            <button className="danger-button" onClick={() => deleteIncome(income.id)} type="button">Quitar</button>
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="muted-text">Todavia no hay ingresos en la lista.</p>
                  )}
                </div>
              </section>
            </section>
          ) : null}

          {activeTab === "cashflow" ? (
            <section className="panel-card blank-panel">
              <div className="panel-heading">
                <h2>Flujo de caja en tabla</h2>
                <p>Esta pestana queda en blanco por ahora.</p>
              </div>
            </section>
          ) : null}

          {activeTab === "charts" ? (
            <section className="panel-card blank-panel">
              <div className="panel-heading">
                <h2>Graficos</h2>
                <p>Esta pestana queda en blanco por ahora.</p>
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function createInitialUserData(user, snapshotDate) {
  return {
    profile: createUserProfile(user),
    cashflowSnapshots: {
      [snapshotDate]: {
        versions: {
          [localId("version")]: createVersionPayload(snapshotDate, emptyWorkspace(), user),
        },
      },
    },
  };
}

function createUserProfile(user) {
  return { uid: user.uid, email: user.email ?? "", currency: "USD", createdAt: Date.now() };
}

function createVersionPayload(snapshotDate, payload, user, sourceVersion = null) {
  const savedAt = Date.now();
  return {
    snapshotDate,
    savedAt,
    createdByUid: user?.uid ?? "",
    createdByEmail: user?.email ?? "",
    sourceSnapshotDate: sourceVersion?.snapshotDate ?? null,
    sourceVersionId: sourceVersion?.versionId ?? null,
    payload: { ...sanitizeWorkspace(payload), updatedAt: savedAt },
  };
}

function emptyWorkspace() {
  return { expenses: {}, incomes: {}, updatedAt: Date.now() };
}

function defaultExpenseForm() {
  return { detail: "", frequency: "", date: localDate(), amount: "", currency: "CLP", merchantName: "", recurrence: "" };
}

function defaultIncomeForm() {
  return { name: "", amount: "", recurrence: "" };
}

function localId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hasWorkspaceShape(value) {
  return Boolean(value && typeof value === "object" && "expenses" in value && "incomes" in value);
}

function hasWorkspaceContent(workspace) {
  return Boolean(Object.keys(workspace?.expenses ?? {}).length || Object.keys(workspace?.incomes ?? {}).length);
}

function normalizeWorkspace(source) {
  if (!source) return emptyWorkspace();
  const candidate = source.payload ?? source;

  if (candidate.entries) {
    return convertLegacyEntries(candidate.entries, candidate.createdAt ?? candidate.savedAt);
  }

  return sanitizeWorkspace({
    expenses: candidate.expenses ?? {},
    incomes: candidate.incomes ?? {},
    updatedAt: candidate.updatedAt ?? candidate.savedAt ?? candidate.createdAt ?? Date.now(),
  });
}

function sanitizeWorkspace(workspace) {
  return {
    expenses: Object.fromEntries(
      Object.entries(workspace?.expenses ?? {}).map(([id, value]) => [
        id,
        {
          detail: String(value?.detail ?? "").trim(),
          frequency: String(value?.frequency ?? "").trim(),
          date: String(value?.date ?? localDate()),
          amount: Number(value?.amount) || 0,
          currency: value?.currency === "USD" ? "USD" : "CLP",
          merchantName: String(value?.merchantName ?? "").trim(),
          recurrence: String(value?.recurrence ?? "").trim(),
          createdAt: Number(value?.createdAt) || Date.now(),
        },
      ]),
    ),
    incomes: Object.fromEntries(
      Object.entries(workspace?.incomes ?? {}).map(([id, value]) => [
        id,
        {
          name: String(value?.name ?? "").trim(),
          amount: Number(value?.amount) || 0,
          recurrence: String(value?.recurrence ?? "").trim(),
          createdAt: Number(value?.createdAt) || Date.now(),
        },
      ]),
    ),
    updatedAt: Number(workspace?.updatedAt) || Date.now(),
  };
}

function convertLegacyEntries(entries, updatedAt = Date.now()) {
  const workspace = emptyWorkspace();
  for (const [id, value] of Object.entries(entries ?? {})) {
    if (value?.type === "income") {
      workspace.incomes[id] = {
        name: String(value?.description ?? "").trim(),
        amount: Number(value?.amount) || 0,
        recurrence: "",
        createdAt: Number(value?.createdAt) || Date.now(),
      };
    } else {
      workspace.expenses[id] = {
        detail: String(value?.description ?? "").trim(),
        frequency: "",
        date: localDate(new Date(Number(value?.createdAt) || Date.now())),
        amount: Number(value?.amount) || 0,
        currency: "USD",
        merchantName: "",
        recurrence: "",
        createdAt: Number(value?.createdAt) || Date.now(),
      };
    }
  }
  workspace.updatedAt = Number(updatedAt) || Date.now();
  return workspace;
}

function extractRecentVersions(snapshotTree) {
  const versions = [];
  for (const [snapshotDate, snapshotValue] of Object.entries(snapshotTree ?? {})) {
    if (snapshotValue?.versions) {
      for (const [versionId, version] of Object.entries(snapshotValue.versions)) {
        versions.push({
          key: buildKey(snapshotDate, versionId),
          snapshotDate,
          versionId,
          savedAt: Number(version?.savedAt) || 0,
          payload: normalizeWorkspace(version),
        });
      }
    } else if (snapshotValue) {
      versions.push({
        key: buildKey(snapshotDate, `legacy_${snapshotValue.createdAt ?? 0}`),
        snapshotDate,
        versionId: `legacy_${snapshotValue.createdAt ?? 0}`,
        savedAt: Number(snapshotValue?.createdAt) || 0,
        payload: normalizeWorkspace(snapshotValue),
      });
    }
  }
  return versions.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

function getLatestVersion(snapshotTree) {
  return extractRecentVersions(snapshotTree)[0] ?? null;
}

function buildKey(snapshotDate, versionId) {
  return `${snapshotDate}__${versionId}`;
}

function validateExpense(expense) {
  if (!String(expense.detail ?? "").trim()) return "El gasto debe tener datos o detalle.";
  if (!String(expense.date ?? "").trim()) return "El gasto debe tener fecha.";
  if (!String(expense.merchantName ?? "").trim()) return "El gasto debe tener nombre del comercio.";
  if (!Number.isFinite(Number(expense.amount)) || Number(expense.amount) <= 0) return "El gasto debe tener un valor mayor que cero.";
  return "";
}

function validateIncome(income) {
  if (!String(income.name ?? "").trim()) return "El ingreso debe tener nombre.";
  if (!Number.isFinite(Number(income.amount)) || Number(income.amount) <= 0) return "El ingreso debe tener un valor mayor que cero.";
  return "";
}

function validateWorkspace(workspace) {
  for (const expense of Object.values(workspace.expenses ?? {})) {
    const error = validateExpense(expense);
    if (error) return error;
  }
  for (const income of Object.values(workspace.incomes ?? {})) {
    const error = validateIncome(income);
    if (error) return error;
  }
  return "";
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value, currency) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: currency === "CLP" ? 0 : 2,
  }).format(Number(value) || 0);
}

function labelVersion(version) {
  return `${version.snapshotDate} | ${new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.savedAt))}`;
}

function toUsdAmount(expense) {
  return Number(expense.amount) || 0;
}

