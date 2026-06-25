"use client"

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Plus, Search, User } from "lucide-react";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const pathname = usePathname();

  const navItems = [
    { label: "Главная", icon: Home, href: "/" },
    { label: "Поиск", icon: Search, href: "/search" },
    { label: "Добавить", icon: Plus, href: "/add", special: true },
    { label: "Профиль", icon: User, href: "/profile" },
  ];

  return (
    <nav className="fixed bottom-4 left-4 right-4 bg-white border-2 border-black shadow-neo rounded-full h-16 px-6 flex items-center justify-between z-50">
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center justify-center transition-all",
              item.special ? "bg-accent-pink p-3 rounded-full -mt-10 border-2 border-black shadow-neo" : "",
              isActive && !item.special ? "text-accent-blue scale-110" : "text-black"
            )}
          >
            <item.icon className={cn("w-6 h-6", item.special && "text-white w-7 h-7")} />
            {!item.special && <span className="text-[10px] font-bold mt-0.5">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
