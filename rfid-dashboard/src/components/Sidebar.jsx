import React from "react";

const LinkItem = ({ label, active = false }) => (
  <button
    className={`w-full text-left px-3 py-2 rounded-md smooth ${
      active
        ? "bg-white/70 dark:bg-white/10 border border-black/5 dark:border-white/10"
        : "hover:bg-black/5 dark:hover:bg-white/10"
    }`}
  >
    {label}
  </button>
);

export default function Sidebar() {
  return (
    <aside className="hidden lg:block">
      <div className="card">
        <div className="text-xs uppercase tracking-wider opacity-60 mb-2">Navigation</div>
        <div className="space-y-1">
          <LinkItem label="Dashboard" active />
          <LinkItem label="Tags" />
          <LinkItem label="POS" />
          <LinkItem label="Security" />
          <LinkItem label="Devices" />
          <LinkItem label="Settings" />
        </div>
      </div>
    </aside>
  );
}
