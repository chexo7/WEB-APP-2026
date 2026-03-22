"use client";

import { useMemo } from "react";
import { Badge, Button, Group, ScrollArea, Table, Text } from "@mantine/core";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

function getExpenseStatus(expense) {
  if (expense.isRecurringIndefinite) {
    return { color: "blue", label: "Recurrente sin fin" };
  }

  if (expense.endDate) {
    return { color: "teal", label: "Con termino" };
  }

  return { color: "gray", label: "Unico" };
}

function getSortIndicator(currentSort, key) {
  if (currentSort.key !== key) {
    return "↕";
  }

  return currentSort.direction === "asc" ? "▲" : "▼";
}

function nextSortState(currentSort, key) {
  if (currentSort.key === key) {
    return {
      key,
      direction: currentSort.direction === "asc" ? "desc" : "asc",
    };
  }

  return {
    key,
    direction: ["movementDate", "endDate", "amount"].includes(key) ? "desc" : "asc",
  };
}

function SortHeader({ currentSort, label, onSortChange, sortKey }) {
  const isActive = currentSort.key === sortKey;

  return (
    <button
      className={isActive ? "sort-button active" : "sort-button"}
      onClick={() => onSortChange(nextSortState(currentSort, sortKey))}
      type="button"
    >
      <span>{label}</span>
      <span className="sort-indicator">{getSortIndicator(currentSort, sortKey)}</span>
    </button>
  );
}

export default function ExpensesTable({
  expenses,
  expenseSort,
  onDeleteExpense,
  onEditExpense,
  onSortChange,
  formatDateLabel,
  formatMoneyLabel,
}) {
  const columns = useMemo(
    () => [
      {
        id: "movementDate",
        header: () => (
          <SortHeader currentSort={expenseSort} label="Fecha Movimiento" onSortChange={onSortChange} sortKey="movementDate" />
        ),
        cell: ({ row }) => formatDateLabel(row.original.movementDate ?? row.original.date),
      },
      {
        id: "name",
        header: () => <SortHeader currentSort={expenseSort} label="Nombre" onSortChange={onSortChange} sortKey="name" />,
        cell: ({ row }) => row.original.name ?? row.original.merchantName ?? row.original.detail ?? "Sin nombre",
      },
      {
        id: "category",
        header: () => <SortHeader currentSort={expenseSort} label="Categoria" onSortChange={onSortChange} sortKey="category" />,
        cell: ({ row }) => row.original.category || "Otros",
      },
      {
        id: "frequency",
        header: () => <SortHeader currentSort={expenseSort} label="Frecuencia" onSortChange={onSortChange} sortKey="frequency" />,
        cell: ({ row }) => row.original.frequency || "Unico",
      },
      {
        id: "endDate",
        header: () => <SortHeader currentSort={expenseSort} label="Fecha Fin" onSortChange={onSortChange} sortKey="endDate" />,
        cell: ({ row }) =>
          row.original.isRecurringIndefinite ? "Sin fin" : row.original.endDate ? formatDateLabel(row.original.endDate) : "No aplica",
      },
      {
        id: "status",
        header: () => <SortHeader currentSort={expenseSort} label="Estado" onSortChange={onSortChange} sortKey="status" />,
        cell: ({ row }) => {
          const status = getExpenseStatus(row.original);

          return (
            <Badge color={status.color} radius="sm" size="sm" variant="light">
              {status.label}
            </Badge>
          );
        },
      },
      {
        id: "currency",
        header: () => <SortHeader currentSort={expenseSort} label="Moneda" onSortChange={onSortChange} sortKey="currency" />,
        cell: ({ row }) => row.original.currency || "USD",
      },
      {
        id: "amount",
        header: () => <SortHeader currentSort={expenseSort} label="Monto" onSortChange={onSortChange} sortKey="amount" />,
        cell: ({ row }) => (
          <Text c="blue.8" className="mantine-amount-cell" fw={700} size="sm">
            {formatMoneyLabel(row.original.amount, row.original.currency)}
          </Text>
        ),
      },
      {
        id: "actions",
        header: () => "Acciones",
        cell: ({ row }) => (
          <Group gap="xs" wrap="wrap">
            <Button onClick={() => onEditExpense(row.original.id)} size="xs" variant="default">
              Modificar
            </Button>
            <Button color="red" onClick={() => onDeleteExpense(row.original.id)} size="xs" variant="light">
              Quitar
            </Button>
          </Group>
        ),
      },
    ],
    [expenseSort, formatDateLabel, formatMoneyLabel, onDeleteExpense, onEditExpense, onSortChange],
  );

  const table = useReactTable({
    data: expenses,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <ScrollArea className="table-wrap mantine-table-wrap" offsetScrollbars scrollbarSize={10}>
      <Table className="mantine-expense-table" striped withColumnBorders withRowBorders withTableBorder>
        <Table.Thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <Table.Tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <Table.Th key={header.id}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </Table.Th>
              ))}
            </Table.Tr>
          ))}
        </Table.Thead>

        <Table.Tbody>
          {table.getRowModel().rows.map((row) => (
            <Table.Tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <Table.Td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
