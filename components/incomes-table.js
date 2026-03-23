"use client";

import { useMemo } from "react";
import { Badge, Button, Group, ScrollArea, Table, Text } from "@mantine/core";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

function getIncomeStatus(income) {
  if (income.isRecurringIndefinite) {
    return { color: "blue", label: "Recurrente sin fin" };
  }

  if (income.endDate) {
    return { color: "teal", label: "Con termino" };
  }

  return { color: "gray", label: "Unico" };
}

function getIncomeType(income) {
  return income.isReimbursement
    ? { color: "orange", label: "Reembolso" }
    : { color: "green", label: "Ingreso real" };
}

function getSortIndicator(currentSort, key) {
  if (currentSort.key !== key) {
    return "<->";
  }

  return currentSort.direction === "asc" ? "^" : "v";
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
    direction: ["startDate", "endDate", "amount"].includes(key) ? "desc" : "asc",
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

export default function IncomesTable({
  formatDateLabel,
  formatMoneyLabel,
  formatTimestampLabel,
  incomeSort,
  incomes,
  onDeleteIncome,
  onEditIncome,
  onManageSchedule,
  onSortChange,
}) {
  const columns = useMemo(
    () => [
      {
        id: "startDate",
        header: () => <SortHeader currentSort={incomeSort} label="Fecha Inicio" onSortChange={onSortChange} sortKey="startDate" />,
        cell: ({ row }) =>
          row.original.startDate ? formatDateLabel(row.original.startDate) : formatTimestampLabel(row.original.createdAt),
      },
      {
        id: "name",
        header: () => <SortHeader currentSort={incomeSort} label="Nombre" onSortChange={onSortChange} sortKey="name" />,
        cell: ({ row }) => row.original.name || "Sin nombre",
      },
      {
        id: "type",
        header: () => <SortHeader currentSort={incomeSort} label="Tipo" onSortChange={onSortChange} sortKey="type" />,
        cell: ({ row }) => {
          const type = getIncomeType(row.original);

          return (
            <Badge color={type.color} radius="sm" size="sm" variant="light">
              {type.label}
            </Badge>
          );
        },
      },
      {
        id: "reimbursementCategory",
        header: () => (
          <SortHeader
            currentSort={incomeSort}
            label="Categoria Ajuste"
            onSortChange={onSortChange}
            sortKey="reimbursementCategory"
          />
        ),
        cell: ({ row }) => (row.original.isReimbursement ? row.original.reimbursementCategory || "Sin categoria" : "No aplica"),
      },
      {
        id: "frequency",
        header: () => <SortHeader currentSort={incomeSort} label="Frecuencia" onSortChange={onSortChange} sortKey="frequency" />,
        cell: ({ row }) => row.original.frequency || "Mensual",
      },
      {
        id: "endDate",
        header: () => <SortHeader currentSort={incomeSort} label="Fecha Fin" onSortChange={onSortChange} sortKey="endDate" />,
        cell: ({ row }) =>
          row.original.isRecurringIndefinite ? "Sin fin" : row.original.endDate ? formatDateLabel(row.original.endDate) : "No aplica",
      },
      {
        id: "status",
        header: () => <SortHeader currentSort={incomeSort} label="Estado" onSortChange={onSortChange} sortKey="status" />,
        cell: ({ row }) => {
          const status = getIncomeStatus(row.original);

          return (
            <Badge color={status.color} radius="sm" size="sm" variant="light">
              {status.label}
            </Badge>
          );
        },
      },
      {
        id: "calendar",
        header: () => "Calendario",
        cell: ({ row }) => {
          const overrides = Object.values(row.original.scheduleOverrides ?? {}).filter((value) => value?.adjustedDate);
          const activeOverrides = overrides.filter((value) => value?.isActive !== false);

          if (!overrides.length) {
            return (
              <Badge color="gray" radius="sm" size="sm" variant="light">
                Sin ajustes
              </Badge>
            );
          }

          return (
            <Group gap="xs">
              <Badge color="blue" radius="sm" size="sm" variant="light">
                {activeOverrides.length} activos
              </Badge>
              <Badge color="gray" radius="sm" size="sm" variant="light">
                {overrides.length} total
              </Badge>
            </Group>
          );
        },
      },
      {
        id: "currency",
        header: () => <SortHeader currentSort={incomeSort} label="Moneda" onSortChange={onSortChange} sortKey="currency" />,
        cell: ({ row }) => row.original.currency || "USD",
      },
      {
        id: "amount",
        header: () => <SortHeader currentSort={incomeSort} label="Monto" onSortChange={onSortChange} sortKey="amount" />,
        cell: ({ row }) => (
          <Text c="blue.8" className="mantine-amount-cell" fw={700} size="sm">
            {formatMoneyLabel(row.original.amount, row.original.currency || "USD")}
          </Text>
        ),
      },
      {
        id: "actions",
        header: () => "Acciones",
        cell: ({ row }) => (
          <Group gap="xs" wrap="wrap">
            <Button onClick={() => onManageSchedule(row.original.id)} size="xs" variant="light">
              Ajustar pagos
            </Button>
            <Button onClick={() => onEditIncome(row.original.id)} size="xs" variant="default">
              Modificar
            </Button>
            <Button color="red" onClick={() => onDeleteIncome(row.original.id)} size="xs" variant="light">
              Quitar
            </Button>
          </Group>
        ),
      },
    ],
    [formatDateLabel, formatMoneyLabel, formatTimestampLabel, incomeSort, onDeleteIncome, onEditIncome, onManageSchedule, onSortChange],
  );

  const table = useReactTable({
    data: incomes,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <ScrollArea className="table-wrap mantine-table-wrap" offsetScrollbars scrollbarSize={10}>
      <Table className="mantine-data-table" striped withColumnBorders withRowBorders withTableBorder>
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
