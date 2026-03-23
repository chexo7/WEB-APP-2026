"use client";

import { useMemo } from "react";
import { Badge, Button, Group, ScrollArea, Table, Text } from "@mantine/core";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

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
    direction: ["date", "amount"].includes(key) ? "desc" : "asc",
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

function getImpact(adjustment) {
  if (Number(adjustment.amount) < 0) {
    return { color: "red", label: "Reduce saldo" };
  }

  if (Number(adjustment.amount) > 0) {
    return { color: "teal", label: "Aumenta saldo" };
  }

  return { color: "gray", label: "Sin efecto" };
}

export default function ReconciliationTable({
  adjustments,
  adjustmentSort,
  formatDateLabel,
  formatMoneyLabel,
  onDeleteAdjustment,
  onEditAdjustment,
  onSortChange,
}) {
  const columns = useMemo(
    () => [
      {
        id: "date",
        header: () => <SortHeader currentSort={adjustmentSort} label="Fecha Ajuste" onSortChange={onSortChange} sortKey="date" />,
        cell: ({ row }) => formatDateLabel(row.original.date),
      },
      {
        id: "type",
        header: () => <SortHeader currentSort={adjustmentSort} label="Categoria" onSortChange={onSortChange} sortKey="type" />,
        cell: () => (
          <Badge color="indigo" radius="sm" size="sm" variant="light">
            Cuadre
          </Badge>
        ),
      },
      {
        id: "amount",
        header: () => <SortHeader currentSort={adjustmentSort} label="Ajuste" onSortChange={onSortChange} sortKey="amount" />,
        cell: ({ row }) => (
          <Text c="blue.8" className="mantine-amount-cell" fw={700} size="sm">
            {formatMoneyLabel(row.original.amount, "USD")}
          </Text>
        ),
      },
      {
        id: "impact",
        header: () => <SortHeader currentSort={adjustmentSort} label="Impacto" onSortChange={onSortChange} sortKey="impact" />,
        cell: ({ row }) => {
          const impact = getImpact(row.original);

          return (
            <Badge color={impact.color} radius="sm" size="sm" variant="light">
              {impact.label}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: () => "Acciones",
        cell: ({ row }) => (
          <Group gap="xs" wrap="wrap">
            <Button onClick={() => onEditAdjustment(row.original.id)} size="xs" variant="default">
              Modificar
            </Button>
            <Button color="red" onClick={() => onDeleteAdjustment(row.original.id)} size="xs" variant="light">
              Quitar
            </Button>
          </Group>
        ),
      },
    ],
    [adjustmentSort, formatDateLabel, formatMoneyLabel, onDeleteAdjustment, onEditAdjustment, onSortChange],
  );

  const table = useReactTable({
    data: adjustments,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <ScrollArea className="table-wrap mantine-table-wrap" offsetScrollbars scrollbarSize={10}>
      <Table className="mantine-data-table mantine-reconciliation-table" striped withColumnBorders withRowBorders withTableBorder>
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
