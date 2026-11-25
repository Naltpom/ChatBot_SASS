// Retour de la connexion par le navigateur (chapotecm://auth) : le code est lu par l'écran de connexion.
import { Redirect } from 'expo-router'
export default function AuthReturn() { return <Redirect href="/" /> }
