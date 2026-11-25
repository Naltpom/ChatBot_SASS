import Svg, { Path } from 'react-native-svg'
import { PATHS, type IconName } from './icons'
import { useTheme } from './theme'

export type { IconName }

export function Icon({ name, size = 20, color, strokeWidth = 1.9 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const { c } = useTheme()
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || c.text} strokeWidth={strokeWidth}
         strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={PATHS[name]} />
    </Svg>
  )
}
