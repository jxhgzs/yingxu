#!/usr/bin/env python3
"""Build and exercise only our own tiny ARM64 fixture; never runs the target app."""
import argparse, fractions, hashlib, json, os, pathlib, random, subprocess, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/rea/oracle-test'
SOURCE=OUT/'editor_oracle.c'; BIN=OUT/'editor_oracle'
NODE='/Users/tal/.nvm/versions/node/v24.18.0/bin/node'
REA=ROOT/'artifacts/rea/runtime/node_modules/rea-agents/scripts/rea.mjs'
rows=json.loads((OUT/'runs.json').read_text()) if (OUT/'runs.json').exists() else []
def run(label,args,env=None,timeout=90):
    t=time.perf_counter();p=subprocess.run([str(a) for a in args],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    (OUT/(label+'.stdout')).write_bytes(p.stdout);(OUT/(label+'.stderr')).write_bytes(p.stderr)
    row={'name':label,'command':[str(a) for a in args],'exitCode':p.returncode,'elapsedSeconds':round(time.perf_counter()-t,6),'stdoutBytes':len(p.stdout),'stderrBytes':len(p.stderr)}
    rows.append(row);(OUT/'runs.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');assert p.returncode==0,row
    return p.stdout

def prep():
    rows.clear()
    run('clang-version',['/usr/bin/clang','--version'])
    run('decompile-help',[NODE,REA,'decompile','--help'])
    run('build',['/usr/bin/clang','-arch','arm64','-O1','-g','-fno-inline','-Wall','-Wextra','-Werror',SOURCE,'-o',BIN])
    symbols=run('nm-symbols',['/usr/bin/nm','-g',BIN]).decode()
    assert '_split_and_retime_us' in symbols and '_keyframe_value_milli' in symbols
    run('file',['/usr/bin/file',BIN]);cases=[]
    def case(mode,args,expected):
        t=time.perf_counter();p=subprocess.run([str(BIN),mode,*map(str,args)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        actual=int(p.stdout) if p.returncode==0 else None
        cases.append(dict(mode=mode,inputs=args,expected=expected,actual=actual,passed=p.returncode==0 and actual==expected,exitCode=p.returncode,elapsedSeconds=round(time.perf_counter()-t,6)))
    from fractions import Fraction as F
    LIM=2**63-1
    def split_expected(a,d,s,v):
        if min(a,d)<0 or F(a)+d>LIM or not 1<=v<=16 or not a<=s<=F(a)+d:return -1
        exact=(F(a)+d-s)/v
        return exact.numerator//exact.denominator
    explicit=[(0,6000000,3000000,2),(1000000,6000000,4000000,2),(0,6000000,0,2),(0,6000000,6000000,2),(0,6000000,-1,2),(0,6000000,6000001,2),(-1,6000000,3000000,2),(0,-1,0,2),(LIM,1,LIM,2),(0,6000000,3000000,0),(0,6000000,3000000,17),(0,0,0,1),(LIM,0,LIM,16)]
    rng=random.Random(590)
    for i in range(120):
        a=rng.randrange(0,10000000);d=rng.randrange(0,10000000)
        s=rng.choice([a-1,a,a+1,a+d-1,a+d,a+d+1,a+d//2]);v=rng.choice([0,1,2,3,4,16,17])
        explicit.append((a,d,s,v))
    for args in explicit:case('split',list(args),split_expected(*args))
    knots=[(0,0),(1000000,1000),(3000000,-500),(6000000,2000)]
    def keyframe_expected(t):
        if t<=knots[0][0]:return knots[0][1]
        if t>=knots[-1][0]:return knots[-1][1]
        for (ta,va),(tb,vb) in zip(knots,knots[1:]):
            if ta<=t<tb:
                # Rational interpolation magnitude truncates before adding/subtracting anchor.
                magnitude=F(t-ta,tb-ta)*abs(vb-va)
                return va+(1 if vb>=va else -1)*(magnitude.numerator//magnitude.denominator)
    points=[-LIM,-1,0,1,999,999999,1000000,1000001,1999999,2000000,2999999,3000000,3000001,4500000,5999999,6000000,6000001,LIM]
    points.extend(rng.randrange(-1000000,7000001) for _ in range(120))
    for t in points:case('keyframe',[t],keyframe_expected(t))
    result={'fixture':'self-authored; not code from Jianying','binary':str(BIN),'sourceSHA256':hashlib.file_digest(open(SOURCE,'rb'),'sha256').hexdigest(),'binarySHA256':hashlib.file_digest(open(BIN,'rb'),'sha256').hexdigest(),'oracle':'independent Python fractions.Fraction with explicit rounding policy','splitCount':len(explicit),'keyframeCount':len(points),'passedCount':sum(c['passed'] for c in cases),'failedCount':sum(not c['passed'] for c in cases),'cases':cases}
    (OUT/'oracle-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    assert result['failedCount']==0
    print(json.dumps({k:v for k,v in result.items() if k!='cases'},ensure_ascii=False,indent=2))

def decompile():
    provider=os.environ.get('GHIDRA_INSTALL_DIR')
    if not provider or not (pathlib.Path(provider)/'Ghidra/Features/Decompiler/os/mac_arm_64/decompile').is_file():
        raise RuntimeError('Set GHIDRA_INSTALL_DIR to a verified local provider with native mac_arm_64/decompile')
    if not os.environ.get('JAVA_HOME'):raise RuntimeError('Set JAVA_HOME explicitly for the local provider process')
    env=dict(os.environ,PATH='/Users/tal/.nvm/versions/node/v24.18.0/bin:/opt/homebrew/bin:/usr/bin:/bin')
    symbols=subprocess.check_output(['/usr/bin/nm','-g',str(BIN)],text=True)
    symbol_addresses={parts[2]:'0x'+parts[0] for line in symbols.splitlines() if len(parts:=line.split())==3 and parts[1] in ['T','t']}
    for symbol in ['split_and_retime_us','keyframe_value_milli']:
        address=symbol_addresses['_'+symbol]
        run('rea-'+symbol+'-address',[NODE,REA,'decompile',BIN,'--procedure',address,'--provider','ghidra','--format','json'],env=env,timeout=300)
    print('Two real REA provider requests completed; semantic review still required.')

if __name__=='__main__':
    parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group(required=True);group.add_argument('--prepare',action='store_true');group.add_argument('--decompile',action='store_true');args=parser.parse_args()
    if args.prepare:prep()
    elif args.decompile:decompile()
