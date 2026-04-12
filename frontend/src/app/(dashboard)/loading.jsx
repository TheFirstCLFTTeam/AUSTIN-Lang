import { DotLottieReact } from '@lottiefiles/dotlottie-react';

export default function Loading() {
    return (
        <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-4">
                <DotLottieReact
                    src="https://lottie.host/c0dd85b9-4b16-423a-acc1-a99b7db2fa8b/JTRJuIh54G.lottie"
                    loop
                    autoplay
                    style={{ width: 200, height: 200 }}
                />
                <p className="text-[0.875rem] font-medium" style={{ color: '#7a7574' }}>
                    Loading...
                </p>
            </div>
        </div>
    );
}
