import {
  BarChart3,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  HelpCircle,
  LayoutGrid,
  LogOut,
  Stethoscope,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "@/lib/nav";

export const NAV_ICONS: Record<NavItem["icon"], LucideIcon> = {
  calendar: CalendarPlus,
  clipboard: ClipboardList,
  layout: LayoutGrid,
  userPlus: UserPlus,
  calendarDays: CalendarDays,
  stethoscope: Stethoscope,
  chart: BarChart3,
  barChart: BarChart3,
  help: HelpCircle,
  logout: LogOut,
};
