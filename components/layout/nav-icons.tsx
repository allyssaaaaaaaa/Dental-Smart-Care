import {
  Activity,
  BarChart3,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  HelpCircle,
  Hourglass,
  LayoutGrid,
  ListOrdered,
  LogOut,
  Stethoscope,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "@/lib/nav";

export const NAV_ICONS: Record<NavItem["icon"], LucideIcon> = {
  calendar: CalendarPlus,
  clipboard: ClipboardList,
  hourglass: Hourglass,
  layout: LayoutGrid,
  queue: ListOrdered,
  userPlus: UserPlus,
  activity: Activity,
  calendarDays: CalendarDays,
  stethoscope: Stethoscope,
  chart: Activity,
  barChart: BarChart3,
  help: HelpCircle,
  logout: LogOut,
};
