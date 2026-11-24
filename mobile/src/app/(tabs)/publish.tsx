// Onglet « + » : ouvre la nouvelle publication (le bouton de l'onglet y mène directement).
import { Redirect } from 'expo-router'
export default function Publish() { return <Redirect href="/new" /> }
