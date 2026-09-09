'use client';
import {useEffect,useState,useCallback,type SetStateAction} from 'react';
import {readLocal,writeLocal,preferenceKey} from '@/shared/local-preferences';
import {useSalon} from './provider';

export function useLocalPreference<T>(name:string,fallback:T) {
  const {catalog,session}=useSalon();
  const key=preferenceKey(catalog.salon.id,session?.user.id,name);
  const [state,setState]=useState<T>(()=>readLocal(key,fallback));
  useEffect(()=>{setState(readLocal(key,fallback));},[key]);
  const update=useCallback((value:SetStateAction<T>)=>{
    setState(previous=>{
      const next=typeof value==='function'?(value as (prev:T)=>T)(previous):value;
      writeLocal(key,next);
      return next;
    });
  },[key]);
  return [state,update] as const;
}
