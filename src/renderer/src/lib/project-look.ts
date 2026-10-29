import {
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  ChartLine,
  Cloud,
  Code,
  Database,
  FileText,
  FlaskConical,
  Folder,
  FolderX,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  House,
  Leaf,
  Monitor,
  Music,
  Palette,
  PenLine,
  Rocket,
  Server,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Camera,
  SquareTerminal,
  Wrench,
  type LucideIcon
} from 'lucide-vue-next'
import type { ProjectColor, ProjectIcon } from '../../../shared/types'
import type { ProjectView } from '../../../shared/projects'
import type { MessageKey } from '../../../shared/i18n'

/** Icono de lucide de cada icono de proyecto. */
export const PROJECT_ICON_COMPONENTS: Record<ProjectIcon, LucideIcon> = {
  folder: Folder,
  monitor: Monitor,
  code: Code,
  terminal: SquareTerminal,
  globe: Globe,
  smartphone: Smartphone,
  server: Server,
  database: Database,
  cloud: Cloud,
  bot: Bot,
  brain: Brain,
  sparkles: Sparkles,
  book: BookOpen,
  file: FileText,
  pen: PenLine,
  palette: Palette,
  camera: Camera,
  music: Music,
  gamepad: Gamepad2,
  flask: FlaskConical,
  chart: ChartLine,
  briefcase: Briefcase,
  cart: ShoppingCart,
  graduation: GraduationCap,
  house: House,
  heart: Heart,
  rocket: Rocket,
  wrench: Wrench,
  shield: Shield,
  leaf: Leaf
}

/** Nombre accesible de cada icono (clave de traducción). */
export const PROJECT_ICON_LABELS: Record<ProjectIcon, MessageKey> = {
  folder: 'Carpeta',
  monitor: 'Ordenador',
  code: 'Código',
  terminal: 'Terminal',
  globe: 'Web',
  smartphone: 'Móvil',
  server: 'Servidor',
  database: 'Base de datos',
  cloud: 'Nube',
  bot: 'Bot',
  brain: 'Cerebro',
  sparkles: 'Destellos',
  book: 'Libro',
  file: 'Documento',
  pen: 'Escritura',
  palette: 'Diseño',
  camera: 'Foto',
  music: 'Música',
  gamepad: 'Juegos',
  flask: 'Ciencia',
  chart: 'Gráfica',
  briefcase: 'Trabajo',
  cart: 'Tienda',
  graduation: 'Estudios',
  house: 'Casa',
  heart: 'Corazón',
  rocket: 'Cohete',
  wrench: 'Herramientas',
  shield: 'Seguridad',
  leaf: 'Naturaleza'
}

/** Clases estáticas para que Tailwind las genere. */
export const PROJECT_COLOR_CLASSES: Record<ProjectColor, { text: string; bg: string }> = {
  red: { text: 'text-project-red', bg: 'bg-project-red' },
  orange: { text: 'text-project-orange', bg: 'bg-project-orange' },
  amber: { text: 'text-project-amber', bg: 'bg-project-amber' },
  green: { text: 'text-project-green', bg: 'bg-project-green' },
  teal: { text: 'text-project-teal', bg: 'bg-project-teal' },
  blue: { text: 'text-project-blue', bg: 'bg-project-blue' },
  violet: { text: 'text-project-violet', bg: 'bg-project-violet' },
  pink: { text: 'text-project-pink', bg: 'bg-project-pink' },
  gray: { text: 'text-project-gray', bg: 'bg-project-gray' }
}

type Look = Pick<ProjectView, 'icon' | 'color' | 'kind'> & { missing?: boolean }

/** Icono con el que se ve un proyecto: el elegido, o carpeta / monitor para Mi PC. */
export function projectIcon(project: Look | null | undefined): LucideIcon {
  if (!project) return Folder
  if (project.missing) return FolderX
  if (project.icon) return PROJECT_ICON_COMPONENTS[project.icon]
  return project.kind === 'computer' ? Monitor : Folder
}

/** Clase de color del icono; atenuado si la carpeta no existe. */
export function projectColorClass(project: Look | null | undefined): string {
  if (!project) return ''
  if (project.missing) return 'text-muted'
  return project.color ? PROJECT_COLOR_CLASSES[project.color].text : ''
}
