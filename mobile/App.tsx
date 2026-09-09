import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Image, StyleSheet, Text, View } from 'react-native';

SplashScreen.setOptions({
  duration: 450,
  fade: true,
});

export default function App() {
  return (
    <View style={styles.container}>
      <Image source={require('./assets/splash-icon.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>Maison Bella</Text>
      <Text style={styles.subtitle}>Agendamentos de beleza</Text>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF7F2',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  logo: {
    width: 220,
    height: 220,
    marginBottom: 24,
  },
  title: {
    color: '#6D3936',
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#9B5F59',
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
});
