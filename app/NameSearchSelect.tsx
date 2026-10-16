"use client";

import { Children, isValidElement, useState, type ChangeEventHandler, type ReactNode, type SelectHTMLAttributes } from "react";

type NameSearchSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "onChange" | "value"> & {
  children: ReactNode;
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  searchPlaceholder?: string;
};

type OptionProps = { value?: string; children?: ReactNode };

export default function NameSearchSelect({
  children,
  value,
  onChange,
  searchPlaceholder = "Search names...",
  disabled = false,
  ...selectProps
}: NameSearchSelectProps) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matchingChildren = Children.map(children, (child) => {
    if (!normalizedSearch || !isValidElement<OptionProps>(child) || child.type !== "option") return child;
    const optionValue = String(child.props.value ?? "");
    if (!optionValue || optionValue === value) return child;
    const label = typeof child.props.children === "string" || typeof child.props.children === "number" ? String(child.props.children) : "";
    return label.toLocaleLowerCase().includes(normalizedSearch) ? child : null;
  });
  const hasMatchingNames = Children.toArray(children).some((child) => {
    if (!isValidElement<OptionProps>(child) || child.type !== "option") return false;
    const label = typeof child.props.children === "string" || typeof child.props.children === "number" ? String(child.props.children) : "";
    return Boolean(child.props.value) && label.toLocaleLowerCase().includes(normalizedSearch);
  });

  return <div className="name-search-select">
    <input
      className="name-search-select-search"
      type="search"
      aria-label={`Search ${selectProps["aria-label"] ?? "names"}`}
      placeholder={searchPlaceholder}
      value={search}
      onChange={(event) => setSearch(event.target.value)}
      disabled={disabled}
      autoComplete="off"
    />
    <select
      {...selectProps}
      value={value}
      onChange={(event) => { setSearch(""); onChange(event); }}
      disabled={disabled}
    >
      {matchingChildren}
    </select>
    {normalizedSearch && !hasMatchingNames && <span className="name-search-select-empty" role="status">No matching names.</span>}
  </div>;
}
