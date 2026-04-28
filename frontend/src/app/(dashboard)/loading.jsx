import { DotLottieReact } from '@lottiefiles/dotlottie-react';

export default function Loading() {
    return (
        <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-4">
                <DotLottieReact
                    src="/loading.lottie"
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
