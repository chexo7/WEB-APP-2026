"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { get, onValue, push, ref, set } from "firebase/database";
import { getFirebaseAuth, getFirebaseDatabase } from "@/lib/firebase";

const defaultCredentials = { email: "ssfamiliausa@gmail.com", password: "" };
const tabs = [
  { id: "summary", label: "Resumen" },
  { id: "expenses", label: "Gastos" },
  { id: "incomes", label: "Ingresos" },
  { id: "cashflow", label: "Tabla" },
  { id: "charts", label: "Graficos" },
];
const expenseCategories = [
  "Ahorros",
  "Arriendo",
  "Auto",
  "Cosas de Casa",
  "Creditos",
  "Cuentas",
  "Delivery",
  "Deporte",
  "Gastos Comunes",
  "Inversiones",
  "Minimarket",
  "Otros",
  "Panoramas",
  "Regalos para alguien",
  "Ropa",
  "Salidas a comer",
  "Salud",
  "Supermercado",
  "Suscripciones",
  "Transporte Publico",
  "Uber",
  "Vega",
  "Viajes",
];
const expenseFrequencies = ["Unico", "Mensual", "Semanal", "Bi-semanal"];
const expenseCurrencies = [
  { value: "USD", label: "USD - Dolar Estadounidense" },
  { value: "CLP", label: "CLP - Peso Chileno" },
];

export default function HomePage() {
  const [credentials, setCredentials] = useState(defaultCredentials);
  const [authState, setAuthState] = useState("checking");
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");
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
        .sort(
          (a, b) =>
            (b.movementDate ?? b.date ?? "").localeCompare(a.movementDate ?? a.date ?? "") || (b.createdAt ?? 0) - (a.createdAt ?? 0),
        ),
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
          name: expenseForm.name.trim(),
          amount: Number(expenseForm.amount),
          currency: expenseForm.currency,
          category: expenseForm.category,
          frequency: expenseForm.frequency,
          movementDate: expenseForm.movementDate,
          endDate: expenseForm.isRecurringIndefinite ? "" : expenseForm.endDate,
          isRecurringIndefinite: Boolean(expenseForm.isRecurringIndefinite),
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
      name: expense.name ?? expense.merchantName ?? expense.detail ?? "",
      amount: String(expense.amount ?? ""),
      currency: expense.currency ?? "USD",
      category: expense.category ?? "Ahorros",
      frequency: expense.frequency ?? "Unico",
      movementDate: expense.movementDate ?? expense.date ?? localDate(),
      endDate: expense.endDate ?? "",
      isRecurringIndefinite: Boolean(expense.isRecurringIndefinite),
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
          <p className="eyebrow">Web App Flujo De Caja</p>
          <h1>Sketch funcional</h1>
          <p className="muted-text">Trabajas sobre un borrador local y solo guardas una nueva entrada cuando lo confirmas.</p>
        </div>

        <div className="topbar-actions">
          <label className="history-control">
            Ultimas 5 entradas
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
          {activeTab === "summary" ? (
            <section className="summary-panel">
              <div className="summary-grid">
                <article className="summary-card">
                  <span>Version activa</span>
                  <strong>{selectedVersion ? selectedVersion.snapshotDate : "Sin datos"}</strong>
                </article>
                <article className="summary-card">
                  <span>Total ingresos</span>
                  <strong>{money(incomeTotal, "USD")}</strong>
                </article>
                <article className="summary-card">
                  <span>Total gastos</span>
                  <strong>{money(expenseTotal, "USD")}</strong>
                </article>
                <article className="summary-card">
                  <span>Saldo actual</span>
                  <strong>{money(balance, "USD")}</strong>
                </article>
              </div>

              <section className="panel-card blank-panel summary-note">
                <div className="panel-heading">
                  <h2>Resumen general</h2>
                  <p>Desde aqui controlas la version cargada, el estado del borrador y el balance general antes de pasar a cada pestana operativa.</p>
                </div>

                <div className="summary-meta">
                  <div>
                    <span className="summary-meta-label">Entrada seleccionada</span>
                    <strong>{selectedVersion ? labelVersion(selectedVersion) : "Sin historial todavia"}</strong>
                  </div>
                  <div>
                    <span className="summary-meta-label">Registros en borrador</span>
                    <strong>{expenses.length + incomes.length} movimientos</strong>
                  </div>
                </div>
              </section>
            </section>
          ) : null}

          {activeTab === "expenses" ? (
            <section className="workspace-stack expenses-stack">
              <div className="expense-tab-header">
                <h2>Gestion de Gastos</h2>
              </div>

              <form className="panel-card panel-frame entry-form expense-entry-form" onSubmit={saveExpenseToDraft}>
                <div className="expense-form-title">
                  <h3>{editingExpenseId ? "Modificar Gasto" : "Registrar Nuevo Gasto"}</h3>
                </div>

                <div className="expense-form-grid">
                  <label className="expense-field expense-field-full">
                    Nombre:
                    <input name="name" onChange={(e) => setExpenseForm((c) => ({ ...c, name: e.target.value }))} value={expenseForm.name} />
                  </label>
                  <label className="expense-field">
                    Monto:
                    <input inputMode="decimal" name="amount" onChange={(e) => setExpenseForm((c) => ({ ...c, amount: e.target.value }))} value={expenseForm.amount} />
                  </label>
                  <label className="expense-field">
                    Moneda:
                    <select name="currency" onChange={(e) => setExpenseForm((c) => ({ ...c, currency: e.target.value }))} value={expenseForm.currency}>
                      {expenseCurrencies.map((currencyOption) => (
                        <option key={currencyOption.value} value={currencyOption.value}>
                          {currencyOption.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="expense-field">
                    Categoria:
                    <select name="category" onChange={(e) => setExpenseForm((c) => ({ ...c, category: e.target.value }))} value={expenseForm.category}>
                      <option value="" disabled>
                        -- Selecciona Categoria --
                      </option>
                      {expenseCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="expense-field">
                    Frecuencia:
                    <select name="frequency" onChange={(e) => setExpenseForm((c) => ({ ...c, frequency: e.target.value }))} value={expenseForm.frequency}>
                      {expenseFrequencies.map((frequency) => (
                        <option key={frequency} value={frequency}>
                          {frequency}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="expense-field">
                    Fecha Movimiento:
                    <input
                      name="movementDate"
                      onChange={(e) => setExpenseForm((c) => ({ ...c, movementDate: e.target.value }))}
                      type="date"
                      value={expenseForm.movementDate}
                    />
                  </label>
                  <label className="expense-field">
                    Fecha Fin (si aplica):
                    <input
                      disabled={expenseForm.isRecurringIndefinite}
                      name="endDate"
                      onChange={(e) => setExpenseForm((c) => ({ ...c, endDate: e.target.value }))}
                      type="date"
                      value={expenseForm.endDate}
                    />
                  </label>
                </div>

                <label className="expense-checkbox">
                  <input
                    checked={expenseForm.isRecurringIndefinite}
                    name="isRecurringIndefinite"
                    onChange={(e) => setExpenseForm((c) => ({ ...c, isRecurringIndefinite: e.target.checked, endDate: e.target.checked ? "" : c.endDate }))}
                    type="checkbox"
                  />
                  Gasto recurrente sin fin
                </label>

                <div className="button-row">
                  <button className="primary-button" type="submit">
                    {editingExpenseId ? "Actualizar gasto" : "Anadir gasto"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setExpenseForm(defaultExpenseForm());
                      setEditingExpenseId("");
                    }}
                    type="button"
                  >
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

              <section className="panel-card panel-frame panel-table">
                <div className="panel-heading">
                  <h2>Lista de gastos</h2>
                  <p>Las entradas quedan visibles como lista editable antes de guardarlas como nueva version.</p>
                </div>

                <div className="table-wrap">
                  {expenses.length ? (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Fecha Movimiento</th>
                          <th>Nombre</th>
                          <th>Categoria</th>
                          <th>Frecuencia</th>
                          <th>Fecha Fin</th>
                          <th>Monto</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenses.map((expense) => (
                          <tr key={expense.id}>
                            <td>{formatDateLabel(expense.movementDate ?? expense.date)}</td>
                            <td>{expense.name ?? expense.merchantName ?? expense.detail ?? "Sin nombre"}</td>
                            <td>{expense.category || "Otros"}</td>
                            <td>
                              <strong>{expense.frequency || "Unico"}</strong>
                              <span>{expense.isRecurringIndefinite ? "Recurrente sin fin" : "Segun configuracion"}</span>
                            </td>
                            <td>{expense.isRecurringIndefinite ? "Sin fin" : expense.endDate ? formatDateLabel(expense.endDate) : "No aplica"}</td>
                            <td className="amount-cell">{money(expense.amount, expense.currency)}</td>
                            <td className="actions-cell">
                              <div className="table-actions">
                                <button className="secondary-button" onClick={() => editExpense(expense.id)} type="button">Modificar</button>
                                <button className="danger-button" onClick={() => deleteExpense(expense.id)} type="button">Quitar</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted-text">Todavia no hay gastos en la lista.</p>
                  )}
                </div>
              </section>
            </section>
          ) : null}

          {activeTab === "incomes" ? (
            <section className="workspace-stack">
              <form className="panel-card panel-frame entry-form" onSubmit={saveIncomeToDraft}>
                <div className="panel-heading">
                  <h2>{editingIncomeId ? "Modificar entrada (ingreso)" : "Agregar entrada (ingreso)"}</h2>
                  <p>Deja listos los ingresos del borrador y luego genera una nueva entrada cuando estes seguro.</p>
                </div>

                <div className="form-grid form-grid-incomes">
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
                </div>

                <div className="button-row">
                  <button className="primary-button" type="submit">
                    {editingIncomeId ? "Actualizar ingreso" : "Anadir ingreso"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setIncomeForm(defaultIncomeForm());
                      setEditingIncomeId("");
                    }}
                    type="button"
                  >
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

              <section className="panel-card panel-frame panel-table">
                <div className="panel-heading">
                  <h2>Lista de ingresos</h2>
                  <p>Cada ingreso del borrador queda editable antes de guardarlo como nueva entrada.</p>
                </div>

                <div className="table-wrap">
                  {incomes.length ? (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Nombre</th>
                          <th>Recurrencia</th>
                          <th>Monto</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {incomes.map((income) => (
                          <tr key={income.id}>
                            <td>{formatTimestampLabel(income.createdAt)}</td>
                            <td>{income.name || "Sin nombre"}</td>
                            <td>{income.recurrence || "Sin recurrencia"}</td>
                            <td className="amount-cell">{money(income.amount, "USD")}</td>
                            <td className="actions-cell">
                              <div className="table-actions">
                                <button className="secondary-button" onClick={() => editIncome(income.id)} type="button">Modificar</button>
                                <button className="danger-button" onClick={() => deleteIncome(income.id)} type="button">Quitar</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
                <p>Esta pestana queda reservada para la tabla completa del flujo de caja.</p>
              </div>
              <p className="placeholder-copy">Queda vacia por ahora para que podamos construirla despues sobre la misma base de datos.</p>
            </section>
          ) : null}

          {activeTab === "charts" ? (
            <section className="panel-card blank-panel">
              <div className="panel-heading">
                <h2>Graficos</h2>
                <p>Esta pestana queda reservada para indicadores y visualizaciones.</p>
              </div>
              <p className="placeholder-copy">Cuando quieras, aqui armamos barras, lineas y distribuciones por categoria.</p>
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
  return {
    name: "",
    amount: "",
    currency: "USD",
    category: "Ahorros",
    frequency: "Unico",
    movementDate: localDate(),
    endDate: "",
    isRecurringIndefinite: false,
  };
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
          name: String(value?.name ?? value?.merchantName ?? value?.detail ?? "").trim(),
          amount: Number(value?.amount) || 0,
          currency: value?.currency === "CLP" ? "CLP" : "USD",
          category: expenseCategories.includes(String(value?.category ?? "")) ? String(value?.category) : "Otros",
          frequency: expenseFrequencies.includes(String(value?.frequency ?? "")) ? String(value?.frequency) : "Unico",
          movementDate: String(value?.movementDate ?? value?.date ?? localDate()),
          endDate: String(value?.endDate ?? "").trim(),
          isRecurringIndefinite: Boolean(value?.isRecurringIndefinite),
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
        name: String(value?.description ?? "").trim(),
        amount: Number(value?.amount) || 0,
        currency: "USD",
        category: "Otros",
        frequency: "Unico",
        movementDate: localDate(new Date(Number(value?.createdAt) || Date.now())),
        endDate: "",
        isRecurringIndefinite: false,
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
  if (!String(expense.name ?? "").trim()) return "El gasto debe tener nombre.";
  if (!Number.isFinite(Number(expense.amount)) || Number(expense.amount) <= 0) return "El gasto debe tener un valor mayor que cero.";
  if (!expenseCategories.includes(String(expense.category ?? ""))) return "Selecciona una categoria valida para el gasto.";
  if (!expenseFrequencies.includes(String(expense.frequency ?? ""))) return "Selecciona una frecuencia valida para el gasto.";
  if (!String(expense.movementDate ?? "").trim()) return "El gasto debe tener fecha de movimiento.";
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

function formatDateLabel(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short" }).format(date);
}

function formatTimestampLabel(value) {
  if (!value) return "Sin fecha";
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short" }).format(date);
}

